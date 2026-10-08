-- Phase 4A.1: order engine hardening + commerce safety.
-- Upgrades the existing Phase 4A order engine in place.
-- No payment gateway, shipping, email, refund, webhook, or admin order mutation.

-- Money invariants: preserve DECIMAL/NUMERIC storage and prevent nonsensical totals.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_discount_not_exceed_subtotal_check'
      AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_discount_not_exceed_subtotal_check
      CHECK (discount_total <= subtotal);
  END IF;
END;
$$;

-- Database-level invariant: order and payment states must describe a possible lifecycle state.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_state_payment_consistency_check'
      AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_state_payment_consistency_check
      CHECK (
        (status <> 'pending_payment' or payment_status <> 'paid')
        and (status not in ('paid','processing','shipped','delivered') or payment_status = 'paid')
        and (status <> 'refunded' or payment_status = 'refunded')
        and (payment_status <> 'refunded' or status = 'refunded')
        and (status <> 'paid' or payment_status <> 'failed')
      );
  END IF;
END;
$$;

-- Rebuild the existing state trigger with explicit order/payment consistency rules.
create or replace function public.validate_order_state_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Preserve the existing allowed order-state transitions.
  if new.status <> old.status then
    if not (
      (old.status = 'pending_payment' and new.status in ('paid','cancelled')) or
      (old.status = 'paid' and new.status in ('processing','cancelled','refunded')) or
      (old.status = 'processing' and new.status in ('shipped','refunded')) or
      (old.status = 'shipped' and new.status in ('delivered','refunded')) or
      (old.status in ('delivered','cancelled','refunded') and false)
    ) then
      raise exception 'Invalid order status transition';
    end if;
  end if;

  -- Preserve the existing allowed payment-state transitions.
  if new.payment_status <> old.payment_status then
    if not (
      (old.payment_status = 'pending' and new.payment_status in ('paid','failed')) or
      (old.payment_status = 'paid' and new.payment_status = 'refunded')
    ) then
      raise exception 'Invalid payment status transition';
    end if;
  end if;

  -- Order/payment states must never describe an impossible combination.
  if new.status = 'pending_payment' and new.payment_status = 'paid' then
    raise exception 'Pending payment order cannot have paid payment status';
  end if;

  if new.status in ('paid', 'processing', 'shipped', 'delivered')
     and new.payment_status <> 'paid' then
    raise exception 'Fulfillment order requires paid payment status';
  end if;

  if new.status = 'refunded' and new.payment_status <> 'refunded' then
    raise exception 'Refunded order requires refunded payment status';
  end if;

  if new.payment_status = 'refunded' and new.status <> 'refunded' then
    raise exception 'Refunded payment requires refunded order status';
  end if;

  if new.status = 'paid' and new.payment_status = 'failed' then
    raise exception 'Paid order cannot have failed payment status';
  end if;

  return new;
end;
$$;

drop trigger if exists orders_validate_state_transition on public.orders;
create trigger orders_validate_state_transition
before update on public.orders
for each row execute function public.validate_order_state_transition();

-- Make the consistency rules apply to inserts as well as updates. This prevents a
-- direct trusted/database insert from creating an impossible state combination.
create or replace function public.validate_order_state_consistency()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'pending_payment' and new.payment_status = 'paid' then
    raise exception 'Pending payment order cannot have paid payment status';
  end if;

  if new.status in ('paid', 'processing', 'shipped', 'delivered')
     and new.payment_status <> 'paid' then
    raise exception 'Fulfillment order requires paid payment status';
  end if;

  if new.status = 'refunded' and new.payment_status <> 'refunded' then
    raise exception 'Refunded order requires refunded payment status';
  end if;

  if new.payment_status = 'refunded' and new.status <> 'refunded' then
    raise exception 'Refunded payment requires refunded order status';
  end if;

  if new.status = 'paid' and new.payment_status = 'failed' then
    raise exception 'Paid order cannot have failed payment status';
  end if;

  return new;
end;
$$;

drop trigger if exists orders_validate_state_consistency on public.orders;
create trigger orders_validate_state_consistency
before insert or update on public.orders
for each row execute function public.validate_order_state_consistency();

-- Replace the Phase 4A checkout RPC in place. The browser still supplies only
-- addressId + idempotencyKey; all commercial values are reloaded and recalculated here.
create or replace function public.create_order_from_cart(
  p_address_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_cart_id uuid;
  v_order_id uuid;
  v_order_number text;
  v_existing public.orders;
  v_address public.customer_addresses;
  v_subtotal numeric(12,2) := 0;
  v_discount_total numeric(12,2) := 0;
  v_shipping_total numeric(12,2) := 0;
  v_tax_total numeric(12,2) := 0;
  v_grand_total numeric(12,2) := 0;
  v_item_count integer := 0;
  v_cart_item record;
  v_product public.products;
  v_variant public.product_variants;
  v_unit_price numeric(12,2);
  v_available integer;
  v_line_subtotal numeric(12,2);
  v_address_snapshot jsonb;
  v_order public.orders;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9._:-]{16,128}$' then
    raise exception 'INVALID_IDEMPOTENCY_KEY';
  end if;

  -- Same authenticated user + same key always returns the original order.
  select * into v_existing
  from public.orders
  where user_id = v_user_id and idempotency_key = p_idempotency_key;

  if v_existing.id is not null then
    return jsonb_build_object(
      'existing', true,
      'order_id', v_existing.id,
      'order_number', v_existing.order_number,
      'status', v_existing.status,
      'payment_status', v_existing.payment_status,
      'currency', v_existing.currency,
      'subtotal', v_existing.subtotal,
      'discount_total', v_existing.discount_total,
      'shipping_total', v_existing.shipping_total,
      'tax_total', v_existing.tax_total,
      'grand_total', v_existing.grand_total,
      'item_count', coalesce((select sum(oi.quantity) from public.order_items oi where oi.order_id = v_existing.id), 0)
    );
  end if;

  -- The address is resolved only from the authenticated user's saved addresses.
  select * into v_address
  from public.customer_addresses
  where id = p_address_id and user_id = v_user_id;

  if v_address.id is null then
    raise exception 'INVALID_ADDRESS';
  end if;

  select id into v_cart_id
  from public.carts
  where user_id = v_user_id
  for update;

  if v_cart_id is null then
    raise exception 'EMPTY_CART';
  end if;

  if not exists (select 1 from public.cart_items where cart_id = v_cart_id) then
    raise exception 'EMPTY_CART';
  end if;

  -- Lock cart rows for the complete validate -> snapshot -> order -> items -> clear transaction.
  for v_cart_item in
    select ci.id, ci.product_id, ci.variant_id, ci.quantity
    from public.cart_items ci
    where ci.cart_id = v_cart_id
    order by ci.created_at
    for update
  loop
    if v_cart_item.quantity < 1 or v_cart_item.quantity > 999 then
      raise exception 'INVALID_QUANTITY';
    end if;

    -- Final authoritative product reload; preview values are never trusted.
    select * into v_product
    from public.products p
    where p.id = v_cart_item.product_id
      and p.is_active = true
      and p.status = 'active';

    if v_product.id is null then
      raise exception 'UNAVAILABLE_PRODUCT';
    end if;

    v_variant := null;
    if v_cart_item.variant_id is not null then
      -- Final authoritative variant reload.
      select * into v_variant
      from public.product_variants pv
      where pv.id = v_cart_item.variant_id
        and pv.product_id = v_cart_item.product_id
        and pv.is_active = true;
      if v_variant.id is null then
        raise exception 'UNAVAILABLE_VARIANT';
      end if;
    elsif exists (
      select 1 from public.product_variants pv
      where pv.product_id = v_product.id and pv.is_active = true
    ) then
      raise exception 'VARIANT_REQUIRED';
    end if;

    -- Final authoritative price and availability reload.
    if v_variant.id is not null then
      v_unit_price := coalesce(v_variant.price_override, v_product.price)::numeric(12,2);
      select greatest(i.stock_quantity - i.reserved_quantity, 0)
      into v_available
      from public.inventory i
      where i.variant_id = v_variant.id;
    else
      v_unit_price := v_product.price::numeric(12,2);
      select greatest(i.stock_quantity - i.reserved_quantity, 0)
      into v_available
      from public.inventory i
      where i.product_id = v_product.id;
    end if;

    v_available := coalesce(v_available, 0);
    if v_cart_item.quantity > v_available then
      raise exception 'INSUFFICIENT_STOCK';
    end if;

    v_line_subtotal := (v_unit_price * v_cart_item.quantity)::numeric(12,2);
    v_subtotal := (v_subtotal + v_line_subtotal)::numeric(12,2);
    v_item_count := v_item_count + v_cart_item.quantity;
  end loop;

  -- Phase 4A.1 deliberately has no promotion, shipping, tax, or payment engine.
  v_discount_total := 0;
  v_shipping_total := 0;
  v_tax_total := 0;
  v_grand_total := (v_subtotal - v_discount_total + v_shipping_total + v_tax_total)::numeric(12,2);

  v_address_snapshot := jsonb_build_object(
    'full_name', v_address.full_name,
    'phone', v_address.phone,
    'address_line_1', v_address.address_line_1,
    'address_line_2', v_address.address_line_2,
    'landmark', v_address.landmark,
    'city', v_address.city,
    'state', v_address.state,
    'postal_code', v_address.postal_code,
    'country', v_address.country
  );

  v_order_number := 'NUV-' || to_char(timezone('utc', now()), 'YYYY') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  -- Both address snapshots intentionally originate from the same authenticated saved address.
  insert into public.orders (
    user_id, order_number, status, payment_status, currency,
    subtotal, discount_total, shipping_total, tax_total, grand_total,
    billing_address_snapshot, shipping_address_snapshot, idempotency_key
  ) values (
    v_user_id, v_order_number, 'pending_payment', 'pending', 'INR',
    v_subtotal, v_discount_total, v_shipping_total, v_tax_total, v_grand_total,
    v_address_snapshot, v_address_snapshot, p_idempotency_key
  ) returning * into v_order;

  -- Re-read snapshots from the current authoritative catalog and create historical item copies.
  for v_cart_item in
    select ci.id, ci.product_id, ci.variant_id, ci.quantity
    from public.cart_items ci
    where ci.cart_id = v_cart_id
    order by ci.created_at
  loop
    select * into v_product
    from public.products p
    where p.id = v_cart_item.product_id
      and p.is_active = true
      and p.status = 'active';
    if v_product.id is null then
      raise exception 'UNAVAILABLE_PRODUCT';
    end if;

    v_variant := null;
    if v_cart_item.variant_id is not null then
      select * into v_variant
      from public.product_variants pv
      where pv.id = v_cart_item.variant_id
        and pv.product_id = v_cart_item.product_id
        and pv.is_active = true;
      if v_variant.id is null then
        raise exception 'UNAVAILABLE_VARIANT';
      end if;
    end if;

    v_unit_price := case
      when v_variant.id is not null then coalesce(v_variant.price_override, v_product.price)
      else v_product.price
    end::numeric(12,2);

    insert into public.order_items (
      order_id, product_id, variant_id, product_name, sku, variant_name, variant_sku,
      unit_price, quantity, line_subtotal
    ) values (
      v_order.id, v_product.id, v_variant.id, v_product.name, v_product.sku,
      v_variant.name, v_variant.sku, v_unit_price, v_cart_item.quantity,
      (v_unit_price * v_cart_item.quantity)::numeric(12,2)
    );
  end loop;

  -- Last step of the same transaction: clear the authoritative cart.
  delete from public.cart_items where cart_id = v_cart_id;

  return jsonb_build_object(
    'existing', false,
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'status', v_order.status,
    'payment_status', v_order.payment_status,
    'currency', v_order.currency,
    'subtotal', v_order.subtotal,
    'discount_total', v_order.discount_total,
    'shipping_total', v_order.shipping_total,
    'tax_total', v_order.tax_total,
    'grand_total', v_order.grand_total,
    'item_count', v_item_count
  );
exception
  when unique_violation then
    -- Concurrent same-user retry: return the already committed order, otherwise re-raise.
    select * into v_existing
    from public.orders
    where user_id = v_user_id and idempotency_key = p_idempotency_key;
    if v_existing.id is not null then
      return jsonb_build_object(
        'existing', true,
        'order_id', v_existing.id,
        'order_number', v_existing.order_number,
        'status', v_existing.status,
        'payment_status', v_existing.payment_status,
        'currency', v_existing.currency,
        'subtotal', v_existing.subtotal,
        'discount_total', v_existing.discount_total,
        'shipping_total', v_existing.shipping_total,
        'tax_total', v_existing.tax_total,
        'grand_total', v_existing.grand_total,
        'item_count', coalesce((select sum(oi.quantity) from public.order_items oi where oi.order_id = v_existing.id), 0)
      );
    end if;
    raise;
end;
$$;

revoke all on function public.create_order_from_cart(uuid, text) from public, anon;
grant execute on function public.create_order_from_cart(uuid, text) to authenticated;

comment on table public.orders is 'Phase 4A/4A.1 payment-free order foundation. Monetary values are stored in INR. Payment gateway integration is deferred.';
comment on column public.orders.idempotency_key is 'Unique per authenticated user and checkout attempt; retries return the existing order.';
comment on column public.orders.shipping_address_snapshot is 'Immutable historical checkout snapshot derived from the authenticated saved customer address.';
comment on column public.orders.billing_address_snapshot is 'Immutable historical checkout snapshot derived from the same authenticated saved customer address as shipping.';
