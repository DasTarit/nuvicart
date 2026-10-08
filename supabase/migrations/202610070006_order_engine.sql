-- Phase 4A: order engine + checkout foundation.
-- Creates an atomic, payment-free CART -> VALIDATE -> ORDER flow.
-- No gateway, payment verification, shipping, refunds, email or admin mutation.

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  order_number text not null unique,
  status text not null default 'pending_payment',
  payment_status text not null default 'pending',
  currency text not null default 'INR',
  subtotal numeric(12,2) not null,
  discount_total numeric(12,2) not null default 0,
  shipping_total numeric(12,2) not null default 0,
  tax_total numeric(12,2) not null default 0,
  grand_total numeric(12,2) not null,
  billing_address_snapshot jsonb,
  shipping_address_snapshot jsonb not null,
  idempotency_key text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint orders_status_check check (status in ('pending_payment','paid','processing','shipped','delivered','cancelled','refunded')),
  constraint orders_payment_status_check check (payment_status in ('pending','paid','failed','refunded')),
  constraint orders_currency_check check (currency = 'INR'),
  constraint orders_money_nonnegative_check check (
    subtotal >= 0 and discount_total >= 0 and shipping_total >= 0 and tax_total >= 0 and grand_total >= 0
  ),
  constraint orders_grand_total_check check (
    grand_total = subtotal - discount_total + shipping_total + tax_total
  ),
  constraint orders_idempotency_key_check check (idempotency_key ~ '^[A-Za-z0-9._:-]{16,128}$')
);

create unique index if not exists orders_user_idempotency_unique_idx
  on public.orders(user_id, idempotency_key);
create index if not exists orders_user_created_idx
  on public.orders(user_id, created_at desc);
create index if not exists orders_number_idx
  on public.orders(order_number);
create index if not exists orders_status_idx
  on public.orders(status);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  variant_id uuid references public.product_variants(id) on delete set null,
  product_name text not null,
  sku text,
  variant_name text,
  variant_sku text,
  unit_price numeric(12,2) not null,
  quantity integer not null,
  line_subtotal numeric(12,2) not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint order_items_unit_price_check check (unit_price >= 0),
  constraint order_items_quantity_check check (quantity >= 1),
  constraint order_items_line_subtotal_check check (line_subtotal = unit_price * quantity)
);

create index if not exists order_items_order_idx on public.order_items(order_id);
create index if not exists order_items_product_idx on public.order_items(product_id);
create index if not exists order_items_variant_idx on public.order_items(variant_id);

create or replace function public.set_order_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
before update on public.orders
for each row execute function public.set_order_updated_at();

create or replace function public.validate_order_state_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
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

  if new.payment_status <> old.payment_status then
    if not (
      (old.payment_status = 'pending' and new.payment_status in ('paid','failed')) or
      (old.payment_status = 'paid' and new.payment_status = 'refunded')
    ) then
      raise exception 'Invalid payment status transition';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists orders_validate_state_transition on public.orders;
create trigger orders_validate_state_transition
before update on public.orders
for each row execute function public.validate_order_state_transition();

alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- Customers may read only their own historical orders. They cannot create or mutate orders directly.
drop policy if exists "orders_select_own" on public.orders;
create policy "orders_select_own"
on public.orders for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "order_items_select_own" on public.order_items;
create policy "order_items_select_own"
on public.order_items for select to authenticated
using (
  exists (
    select 1 from public.orders o
    where o.id = order_items.order_id
      and o.user_id = auth.uid()
  )
);

revoke all on public.orders, public.order_items from anon;
grant select on public.orders, public.order_items to authenticated;
revoke insert, update, delete on public.orders, public.order_items from anon, authenticated;

-- Server-authoritative checkout review. It exposes snapshots/prices and totals only; inventory rows remain private.
create or replace function public.get_checkout_preview()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_cart_id uuid;
  v_item record;
  v_product public.products;
  v_variant public.product_variants;
  v_unit_price numeric(12,2);
  v_available integer;
  v_items jsonb := '[]'::jsonb;
  v_subtotal numeric(12,2) := 0;
  v_line numeric(12,2);
begin
  if v_user_id is null then raise exception 'UNAUTHENTICATED'; end if;

  select id into v_cart_id from public.carts where user_id = v_user_id;
  if v_cart_id is null then
    return jsonb_build_object('currency','INR','items','[]'::jsonb,'subtotal',0,'discountTotal',0,'shippingTotal',0,'taxTotal',0,'grandTotal',0);
  end if;

  for v_item in
    select ci.product_id, ci.variant_id, ci.quantity
    from public.cart_items ci
    where ci.cart_id = v_cart_id
    order by ci.created_at
  loop
    select * into v_product from public.products p
    where p.id = v_item.product_id and p.is_active = true and p.status = 'active';
    if v_product.id is null then raise exception 'UNAVAILABLE_PRODUCT'; end if;

    v_variant := null;
    if v_item.variant_id is not null then
      select * into v_variant from public.product_variants pv
      where pv.id = v_item.variant_id and pv.product_id = v_item.product_id and pv.is_active = true;
      if v_variant.id is null then raise exception 'UNAVAILABLE_VARIANT'; end if;
    elsif exists (select 1 from public.product_variants pv where pv.product_id = v_product.id and pv.is_active = true) then
      raise exception 'VARIANT_REQUIRED';
    end if;

    if v_variant.id is not null then
      v_unit_price := coalesce(v_variant.price_override, v_product.price)::numeric(12,2);
      select greatest(i.stock_quantity - i.reserved_quantity, 0) into v_available from public.inventory i where i.variant_id = v_variant.id;
    else
      v_unit_price := v_product.price::numeric(12,2);
      select greatest(i.stock_quantity - i.reserved_quantity, 0) into v_available from public.inventory i where i.product_id = v_product.id;
    end if;
    v_available := coalesce(v_available,0);
    if v_item.quantity < 1 or v_item.quantity > 999 then raise exception 'INVALID_QUANTITY'; end if;
    if v_item.quantity > v_available then raise exception 'INSUFFICIENT_STOCK'; end if;

    v_line := (v_unit_price * v_item.quantity)::numeric(12,2);
    v_subtotal := (v_subtotal + v_line)::numeric(12,2);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'productId', v_product.id,
      'variantId', v_variant.id,
      'productName', v_product.name,
      'sku', v_product.sku,
      'variantName', v_variant.name,
      'variantSku', v_variant.sku,
      'unitPrice', v_unit_price,
      'quantity', v_item.quantity,
      'lineSubtotal', v_line
    ));
  end loop;

  return jsonb_build_object(
    'currency','INR',
    'items',v_items,
    'subtotal',v_subtotal,
    'discountTotal',0,
    'shippingTotal',0,
    'taxTotal',0,
    'grandTotal',v_subtotal
  );
end;
$$;

revoke all on function public.get_checkout_preview() from public, anon;
grant execute on function public.get_checkout_preview() to authenticated;

-- Payment-free Phase 4A order creation. This function is atomic: it locks the user's cart,
-- validates authoritative catalog/address/inventory data, creates snapshots, and clears the cart.
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
  v_item_count integer := 0;
  v_cart_item record;
  v_product public.products;
  v_variant public.product_variants;
  v_unit_price numeric(12,2);
  v_available integer;
  v_line_subtotal numeric(12,2);
  v_shipping jsonb;
  v_order public.orders;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9._:-]{16,128}$' then
    raise exception 'INVALID_IDEMPOTENCY_KEY';
  end if;

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

  -- Lock the cart items so two concurrent checkout attempts cannot both clear the same cart.
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
    elsif exists (
      select 1 from public.product_variants pv
      where pv.product_id = v_product.id and pv.is_active = true
    ) then
      raise exception 'VARIANT_REQUIRED';
    end if;

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

  v_shipping := jsonb_build_object(
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

  insert into public.orders (
    user_id, order_number, status, payment_status, currency,
    subtotal, discount_total, shipping_total, tax_total, grand_total,
    billing_address_snapshot, shipping_address_snapshot, idempotency_key
  ) values (
    v_user_id, v_order_number, 'pending_payment', 'pending', 'INR',
    v_subtotal, 0, 0, 0, v_subtotal,
    null, v_shipping, p_idempotency_key
  ) returning * into v_order;

  for v_cart_item in
    select ci.id, ci.product_id, ci.variant_id, ci.quantity
    from public.cart_items ci
    where ci.cart_id = v_cart_id
    order by ci.created_at
  loop
    select * into v_product from public.products p where p.id = v_cart_item.product_id;
    v_variant := null;
    if v_cart_item.variant_id is not null then
      select * into v_variant from public.product_variants pv where pv.id = v_cart_item.variant_id;
    end if;
    v_unit_price := case when v_variant.id is not null then coalesce(v_variant.price_override, v_product.price) else v_product.price end;
    insert into public.order_items (
      order_id, product_id, variant_id, product_name, sku, variant_name, variant_sku,
      unit_price, quantity, line_subtotal
    ) values (
      v_order.id, v_product.id, v_variant.id, v_product.name, v_product.sku,
      v_variant.name, v_variant.sku, v_unit_price, v_cart_item.quantity,
      (v_unit_price * v_cart_item.quantity)::numeric(12,2)
    );
  end loop;

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

comment on table public.orders is 'Phase 4A order foundation. Monetary values are stored in INR. Payment gateway integration is deferred.';
comment on column public.orders.idempotency_key is 'Unique per authenticated user and checkout attempt; retries return the existing order.';
comment on column public.orders.shipping_address_snapshot is 'Immutable historical checkout snapshot; later address edits do not affect the order.';
comment on column public.orders.billing_address_snapshot is 'Reserved for future billing-address support; Phase 4A uses shipping address only.';
