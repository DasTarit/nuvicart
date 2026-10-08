-- Phase 4B: Razorpay payment foundation and idempotent finalization.
-- Razorpay secrets remain server-only; payment state is never client-authoritative.

create table if not exists public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  provider text not null default 'razorpay',
  provider_order_id text,
  provider_payment_id text,
  amount numeric(12,2) not null,
  currency text not null default 'INR',
  status text not null default 'created',
  signature_verified boolean not null default false,
  failure_reason text,
  provider_event_id text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint payment_attempts_provider_check check (provider = 'razorpay'),
  constraint payment_attempts_currency_check check (currency = 'INR'),
  constraint payment_attempts_amount_check check (amount >= 0),
  constraint payment_attempts_status_check check (status in ('created','pending','authorized','captured','failed','cancelled','refunded'))
);

create unique index if not exists payment_attempts_provider_order_unique_idx
  on public.payment_attempts(provider, provider_order_id)
  where provider_order_id is not null;
create unique index if not exists payment_attempts_provider_payment_unique_idx
  on public.payment_attempts(provider, provider_payment_id)
  where provider_payment_id is not null;
create index if not exists payment_attempts_order_idx on public.payment_attempts(order_id, created_at desc);
create unique index if not exists payment_attempts_active_order_unique_idx
  on public.payment_attempts(order_id)
  where status in ('created','pending','authorized','captured');

create table if not exists public.payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'razorpay',
  provider_event_id text not null,
  event_type text not null,
  payload jsonb not null,
  signature_verified boolean not null default false,
  received_at timestamptz not null default timezone('utc', now()),
  processed_at timestamptz,
  constraint payment_webhook_events_provider_check check (provider = 'razorpay')
);
create unique index if not exists payment_webhook_events_provider_event_unique_idx
  on public.payment_webhook_events(provider, provider_event_id);

create or replace function public.set_payment_attempt_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists payment_attempts_set_updated_at on public.payment_attempts;
create trigger payment_attempts_set_updated_at
before update on public.payment_attempts
for each row execute function public.set_payment_attempt_updated_at();

alter table public.payment_attempts enable row level security;
alter table public.payment_webhook_events enable row level security;

drop policy if exists "payment_attempts_select_own" on public.payment_attempts;
create policy "payment_attempts_select_own"
on public.payment_attempts for select to authenticated
using (exists (select 1 from public.orders o where o.id = payment_attempts.order_id and o.user_id = auth.uid()));

revoke all on public.payment_attempts, public.payment_webhook_events from anon, authenticated;
grant select on public.payment_attempts to authenticated;

-- Upgrade the existing Phase 4A payment constraint without creating a duplicate orders table.
alter table public.orders drop constraint if exists orders_payment_status_check;
alter table public.orders add constraint orders_payment_status_check check (payment_status in ('pending','paid','failed','paid_inventory_issue','refunded'));

-- Phase 4B extends the Phase 4A payment state machine with a safe retry and an explicit
-- exceptional state for a verified payment whose inventory cannot be finalized.
create or replace function public.validate_order_state_transition()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status <> old.status then
    if not ((old.status = 'pending_payment' and new.status = 'paid') or
            (old.status = 'paid' and new.status in ('processing','cancelled','refunded')) or
            (old.status = 'processing' and new.status in ('shipped','refunded')) or
            (old.status = 'shipped' and new.status in ('delivered','refunded'))) then
      raise exception 'Invalid order status transition';
    end if;
  end if;
  if new.payment_status <> old.payment_status then
    if not ((old.payment_status = 'pending' and new.payment_status in ('paid','failed','paid_inventory_issue')) or
            (old.payment_status = 'failed' and new.payment_status = 'pending') or
            (old.payment_status = 'paid' and new.payment_status = 'refunded')) then
      raise exception 'Invalid payment status transition';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists orders_validate_state_transition on public.orders;
create trigger orders_validate_state_transition before update on public.orders for each row execute function public.validate_order_state_transition();

-- Creates/reuses the server-side payment attempt. No provider call occurs in SQL.
create or replace function public.prepare_payment_attempt(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  v_order public.orders;
  v_attempt public.payment_attempts;
begin
  if v_user_id is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into v_order from public.orders where id = p_order_id and user_id = v_user_id for update;
  if v_order.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status <> 'pending_payment' or v_order.payment_status = 'paid' then raise exception 'ORDER_NOT_PAYABLE'; end if;

  select * into v_attempt from public.payment_attempts
  where order_id = v_order.id and status in ('created','pending','authorized','captured')
  order by created_at desc limit 1;

  if v_attempt.id is null then
    insert into public.payment_attempts(order_id, amount, currency, status)
    values (v_order.id, v_order.grand_total, v_order.currency, 'created') returning * into v_attempt;
  end if;

  return jsonb_build_object('attempt_id', v_attempt.id, 'order_id', v_order.id, 'order_number', v_order.order_number,
    'amount', v_order.grand_total, 'currency', v_order.currency, 'provider_order_id', v_attempt.provider_order_id,
    'attempt_status', v_attempt.status);
end;
$$;
revoke all on function public.prepare_payment_attempt(uuid) from public, anon, authenticated;
grant execute on function public.prepare_payment_attempt(uuid) to authenticated;

create or replace function public.attach_provider_order(p_attempt_id uuid, p_provider_order_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_attempt public.payment_attempts;
  v_order public.orders;
begin
  select * into v_attempt from public.payment_attempts where id = p_attempt_id for update;
  if v_attempt.id is null then raise exception 'PAYMENT_ATTEMPT_NOT_FOUND'; end if;
  select * into v_order from public.orders where id = v_attempt.order_id for update;
  if v_order.id is null or v_order.status <> 'pending_payment' or v_order.payment_status = 'paid' then raise exception 'ORDER_NOT_PAYABLE'; end if;
  if p_provider_order_id is null or length(trim(p_provider_order_id)) = 0 then raise exception 'INVALID_PROVIDER_ORDER_ID'; end if;
  if v_attempt.provider_order_id is not null and v_attempt.provider_order_id <> p_provider_order_id then raise exception 'PROVIDER_ORDER_ALREADY_LINKED'; end if;
  update public.payment_attempts set provider_order_id = p_provider_order_id, status = 'pending' where id = v_attempt.id and provider_order_id is null;
  select * into v_attempt from public.payment_attempts where id = v_attempt.id;
  return jsonb_build_object('attempt_id', v_attempt.id, 'provider_order_id', v_attempt.provider_order_id, 'status', v_attempt.status);
end;
$$;
revoke all on function public.attach_provider_order(uuid, text) from public, anon, authenticated;

-- Server-only finalization. Inventory locks are held in the same transaction as payment/order updates.
create or replace function public.finalize_razorpay_payment(
  p_attempt_id uuid,
  p_provider_payment_id text,
  p_provider_order_id text,
  p_amount_minor bigint,
  p_currency text,
  p_signature_verified boolean,
  p_provider_event_id text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_attempt public.payment_attempts;
  v_order public.orders;
  v_item record;
  v_inventory public.inventory;
  v_amount numeric(12,2);
begin
  if not p_signature_verified then raise exception 'SIGNATURE_NOT_VERIFIED'; end if;
  if p_currency <> 'INR' then raise exception 'CURRENCY_MISMATCH'; end if;
  if p_amount_minor < 0 then raise exception 'INVALID_AMOUNT'; end if;
  v_amount := (p_amount_minor::numeric / 100)::numeric(12,2);

  select * into v_attempt from public.payment_attempts where id = p_attempt_id for update;
  if v_attempt.id is null then raise exception 'PAYMENT_ATTEMPT_NOT_FOUND'; end if;
  select * into v_order from public.orders where id = v_attempt.order_id for update;
  if v_order.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_attempt.provider_order_id is null or v_attempt.provider_order_id <> p_provider_order_id then raise exception 'PROVIDER_ORDER_MISMATCH'; end if;
  if v_attempt.amount <> v_order.grand_total or v_amount <> v_order.grand_total then raise exception 'AMOUNT_MISMATCH'; end if;
  if v_attempt.currency <> p_currency or v_order.currency <> p_currency then raise exception 'CURRENCY_MISMATCH'; end if;

  if v_order.payment_status = 'paid' and v_order.status = 'paid' then
    if v_attempt.provider_payment_id is null then
      update public.payment_attempts set provider_payment_id = p_provider_payment_id, status = 'captured', signature_verified = true, provider_event_id = coalesce(provider_event_id, p_provider_event_id) where id = v_attempt.id;
    end if;
    return jsonb_build_object('already_finalized', true, 'order_id', v_order.id, 'status', v_order.status, 'payment_status', v_order.payment_status);
  end if;

  if v_attempt.provider_payment_id is not null and v_attempt.provider_payment_id <> p_provider_payment_id then raise exception 'PAYMENT_ID_MISMATCH'; end if;
  if v_order.status <> 'pending_payment' or v_order.payment_status <> 'pending' then raise exception 'ORDER_NOT_PAYABLE'; end if;

  for v_item in select * from public.order_items where order_id = v_order.id order by id loop
    if v_item.variant_id is not null then
      select * into v_inventory from public.inventory where variant_id = v_item.variant_id for update;
      if v_inventory.id is null or v_inventory.stock_quantity - v_inventory.reserved_quantity < v_item.quantity then
        raise exception 'INSUFFICIENT_INVENTORY_AT_PAYMENT';
      end if;
      update public.inventory set stock_quantity = stock_quantity - v_item.quantity where id = v_inventory.id;
    else
      select * into v_inventory from public.inventory where product_id = v_item.product_id for update;
      if v_inventory.id is null or v_inventory.stock_quantity - v_inventory.reserved_quantity < v_item.quantity then
        raise exception 'INSUFFICIENT_INVENTORY_AT_PAYMENT';
      end if;
      update public.inventory set stock_quantity = stock_quantity - v_item.quantity where id = v_inventory.id;
    end if;
  end loop;

  if v_attempt.provider_payment_id is not null and v_attempt.provider_payment_id <> p_provider_payment_id then raise exception 'PAYMENT_ID_MISMATCH'; end if;
  update public.payment_attempts
    set provider_payment_id = p_provider_payment_id, status = 'captured', signature_verified = true, provider_event_id = coalesce(p_provider_event_id, provider_event_id)
    where id = v_attempt.id;

  update public.orders set payment_status = 'paid', status = 'paid' where id = v_order.id;
  return jsonb_build_object('already_finalized', false, 'order_id', v_order.id, 'status', 'paid', 'payment_status', 'paid');
exception when unique_violation then
  if sqlerrm ilike '%payment_attempts_provider_payment_unique_idx%' then
    return jsonb_build_object('already_finalized', true, 'order_id', v_order.id, 'status', v_order.status, 'payment_status', v_order.payment_status);
  end if;
  raise;
end;
$$;
revoke all on function public.finalize_razorpay_payment(uuid,text,text,bigint,text,boolean,text) from public, anon, authenticated;

create or replace function public.record_razorpay_inventory_exception(
  p_attempt_id uuid, p_provider_payment_id text, p_provider_event_id text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_attempt public.payment_attempts; v_order public.orders;
begin
  select * into v_attempt from public.payment_attempts where id = p_attempt_id for update;
  if v_attempt.id is null then raise exception 'PAYMENT_ATTEMPT_NOT_FOUND'; end if;
  select * into v_order from public.orders where id = v_attempt.order_id for update;
  update public.payment_attempts set provider_payment_id = p_provider_payment_id, status = 'captured', signature_verified = true, provider_event_id = coalesce(p_provider_event_id, provider_event_id), failure_reason = 'Payment verified; inventory could not be finalized automatically.' where id = v_attempt.id;
  if v_order.payment_status = 'pending' then update public.orders set payment_status = 'paid_inventory_issue' where id = v_order.id; end if;
  return jsonb_build_object('exceptional',true,'order_id',v_order.id,'status',v_order.status,'payment_status','paid_inventory_issue');
end;
$$;
revoke all on function public.record_razorpay_inventory_exception(uuid,text,text) from public, anon, authenticated;

create or replace function public.record_razorpay_failure(
  p_attempt_id uuid,
  p_provider_payment_id text default null,
  p_failure_reason text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_attempt public.payment_attempts; v_order public.orders;
begin
  select * into v_attempt from public.payment_attempts where id = p_attempt_id for update;
  if v_attempt.id is null then raise exception 'PAYMENT_ATTEMPT_NOT_FOUND'; end if;
  select * into v_order from public.orders where id = v_attempt.order_id for update;
  if v_order.payment_status = 'paid' then return jsonb_build_object('already_finalized',true,'status',v_order.status,'payment_status',v_order.payment_status); end if;
  update public.payment_attempts set provider_payment_id = coalesce(p_provider_payment_id, provider_payment_id), status = 'failed', failure_reason = left(p_failure_reason, 1000) where id = v_attempt.id;
  update public.orders set payment_status = 'failed' where id = v_order.id and payment_status = 'pending';
  return jsonb_build_object('already_finalized',false,'status',v_order.status,'payment_status','failed');
end;
$$;
revoke all on function public.record_razorpay_failure(uuid,text,text) from public, anon, authenticated;

create or replace function public.reopen_failed_payment(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_order public.orders;
begin
  if v_user is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into v_order from public.orders where id = p_order_id and user_id = v_user for update;
  if v_order.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status <> 'pending_payment' or v_order.payment_status not in ('pending','failed') then raise exception 'ORDER_NOT_RETRYABLE'; end if;
  update public.orders set payment_status = 'pending' where id = v_order.id;
  return jsonb_build_object('order_id',v_order.id,'order_number',v_order.order_number,'grand_total',v_order.grand_total,'currency',v_order.currency);
end;
$$;
revoke all on function public.reopen_failed_payment(uuid) from public, anon;
grant execute on function public.reopen_failed_payment(uuid) to authenticated;
