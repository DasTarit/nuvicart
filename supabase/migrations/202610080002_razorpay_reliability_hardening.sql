-- Phase 4B.1: Razorpay payment reliability and exception hardening.
-- Extends the existing Phase 4B architecture in place. No duplicate payment,
-- webhook, order, checkout, shipping, refund, email, or admin systems.

-- -----------------------------------------------------------------------------
-- Webhook event processing state
-- -----------------------------------------------------------------------------

alter table public.payment_webhook_events
  add column if not exists processing_at timestamptz,
  add column if not exists processing_token uuid;

create index if not exists payment_webhook_events_processing_idx
  on public.payment_webhook_events(provider, processed_at, processing_at);

-- Claim one verified event for processing. The row lock makes concurrent
-- deliveries of the same event serialize. A stale claim is recoverable after
-- five minutes so a crashed worker does not permanently strand the event.
create or replace function public.claim_razorpay_webhook_event(
  p_provider_event_id text,
  p_event_type text,
  p_payload jsonb,
  p_signature_verified boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.payment_webhook_events;
  v_token uuid;
begin
  if not p_signature_verified then
    raise exception 'SIGNATURE_NOT_VERIFIED';
  end if;
  if p_provider_event_id is null or length(trim(p_provider_event_id)) = 0 then
    raise exception 'INVALID_PROVIDER_EVENT_ID';
  end if;

  insert into public.payment_webhook_events(
    provider, provider_event_id, event_type, payload, signature_verified
  )
  values (
    'razorpay', p_provider_event_id, coalesce(p_event_type, ''), p_payload, true
  )
  on conflict (provider, provider_event_id) do nothing;

  select * into v_event
  from public.payment_webhook_events
  where provider = 'razorpay'
    and provider_event_id = p_provider_event_id
  for update;

  if v_event.processed_at is not null then
    return jsonb_build_object('status', 'processed', 'event_id', v_event.id);
  end if;

  if v_event.processing_at is not null
     and v_event.processing_at > timezone('utc', now()) - interval '5 minutes' then
    return jsonb_build_object('status', 'in_progress', 'event_id', v_event.id);
  end if;

  v_token := gen_random_uuid();
  update public.payment_webhook_events
  set processing_at = timezone('utc', now()),
      processing_token = v_token
  where id = v_event.id;

  return jsonb_build_object(
    'status', 'claimed',
    'event_id', v_event.id,
    'processing_token', v_token
  );
end;
$$;
revoke all on function public.claim_razorpay_webhook_event(text, text, jsonb, boolean) from public, anon, authenticated;

grant execute on function public.claim_razorpay_webhook_event(text, text, jsonb, boolean) to service_role;

create or replace function public.complete_razorpay_webhook_event(
  p_event_id uuid,
  p_processing_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.payment_webhook_events
  set processed_at = coalesce(processed_at, timezone('utc', now())),
      processing_at = null,
      processing_token = null
  where id = p_event_id
    and processing_token = p_processing_token
    and processed_at is null;
  return found;
end;
$$;
revoke all on function public.complete_razorpay_webhook_event(uuid, uuid) from public, anon, authenticated;
grant execute on function public.complete_razorpay_webhook_event(uuid, uuid) to service_role;

create or replace function public.release_razorpay_webhook_event(
  p_event_id uuid,
  p_processing_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.payment_webhook_events
  set processing_at = null,
      processing_token = null
  where id = p_event_id
    and processing_token = p_processing_token
    and processed_at is null;
  return found;
end;
$$;
revoke all on function public.release_razorpay_webhook_event(uuid, uuid) from public, anon, authenticated;
grant execute on function public.release_razorpay_webhook_event(uuid, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- Strict provider payment-attempt lifecycle
-- -----------------------------------------------------------------------------

create or replace function public.validate_payment_attempt_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if not (
    (old.status = 'created' and new.status in ('pending', 'failed', 'cancelled')) or
    (old.status = 'pending' and new.status in ('authorized', 'captured', 'failed', 'cancelled')) or
    (old.status = 'authorized' and new.status in ('captured', 'failed', 'cancelled')) or
    (old.status = 'captured' and new.status = 'refunded')
  ) then
    raise exception 'Invalid payment attempt status transition: % -> %', old.status, new.status;
  end if;

  return new;
end;
$$;

drop trigger if exists payment_attempts_validate_transition on public.payment_attempts;
create trigger payment_attempts_validate_transition
before update on public.payment_attempts
for each row execute function public.validate_payment_attempt_transition();

-- The exceptional payment state is only valid while the order remains
-- pending_payment: payment was verified, but inventory needs operational review.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_paid_inventory_issue_state_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_paid_inventory_issue_state_check
      check (payment_status <> 'paid_inventory_issue' or status = 'pending_payment');
  end if;
end;
$$;

-- Rebuild the existing consistency trigger in place so the exceptional state is
-- explicit while every normal fulfillment state retains its paid requirement.
create or replace function public.validate_order_state_consistency()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'pending_payment' and new.payment_status = 'paid' then
    raise exception 'Pending payment order cannot have paid payment status';
  end if;

  if new.payment_status = 'paid_inventory_issue' and new.status <> 'pending_payment' then
    raise exception 'Inventory exception requires pending_payment order status';
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

-- Keep the transition trigger aligned with the explicit inventory exception.
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
      (old.status = 'shipped' and new.status in ('delivered','refunded'))
    ) then
      raise exception 'Invalid order status transition';
    end if;
  end if;

  if new.payment_status <> old.payment_status then
    if not (
      (old.payment_status = 'pending' and new.payment_status in ('paid','failed','paid_inventory_issue')) or
      (old.payment_status = 'failed' and new.payment_status = 'pending') or
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

-- -----------------------------------------------------------------------------
-- Failure and inventory-exception handlers
-- -----------------------------------------------------------------------------

create or replace function public.record_razorpay_failure(
  p_attempt_id uuid,
  p_provider_payment_id text default null,
  p_failure_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.payment_attempts;
  v_order public.orders;
begin
  select * into v_attempt
  from public.payment_attempts
  where id = p_attempt_id
  for update;
  if v_attempt.id is null then raise exception 'PAYMENT_ATTEMPT_NOT_FOUND'; end if;

  select * into v_order
  from public.orders
  where id = v_attempt.order_id
  for update;
  if v_order.id is null then raise exception 'ORDER_NOT_FOUND'; end if;

  -- Never regress a captured/refunded payment because of a late failure event.
  if v_attempt.status in ('captured', 'refunded')
     or v_order.payment_status in ('paid', 'paid_inventory_issue', 'refunded') then
    return jsonb_build_object(
      'ignored', true,
      'reason', 'payment_already_terminal',
      'status', v_attempt.status,
      'payment_status', v_order.payment_status
    );
  end if;

  if v_attempt.status = 'failed' then
    return jsonb_build_object(
      'already_failed', true,
      'status', v_attempt.status,
      'payment_status', v_order.payment_status
    );
  end if;

  if v_attempt.status not in ('created', 'pending', 'authorized') then
    return jsonb_build_object(
      'ignored', true,
      'reason', 'invalid_failure_transition',
      'status', v_attempt.status,
      'payment_status', v_order.payment_status
    );
  end if;

  update public.payment_attempts
  set provider_payment_id = coalesce(p_provider_payment_id, provider_payment_id),
      status = 'failed',
      failure_reason = left(p_failure_reason, 1000)
  where id = v_attempt.id;

  if v_order.payment_status = 'pending' then
    update public.orders
    set payment_status = 'failed'
    where id = v_order.id;
  end if;

  return jsonb_build_object(
    'already_finalized', false,
    'status', 'failed',
    'payment_status', case when v_order.payment_status = 'pending' then 'failed' else v_order.payment_status end
  );
end;
$$;
revoke all on function public.record_razorpay_failure(uuid, text, text) from public, anon, authenticated;


create or replace function public.record_razorpay_inventory_exception(
  p_attempt_id uuid,
  p_provider_payment_id text,
  p_provider_event_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.payment_attempts;
  v_order public.orders;
begin
  select * into v_attempt
  from public.payment_attempts
  where id = p_attempt_id
  for update;
  if v_attempt.id is null then raise exception 'PAYMENT_ATTEMPT_NOT_FOUND'; end if;

  select * into v_order
  from public.orders
  where id = v_attempt.order_id
  for update;
  if v_order.id is null then raise exception 'ORDER_NOT_FOUND'; end if;

  -- Repeated handling after the first exception is a no-op. Payment remains
  -- captured and the exceptional order state remains the historical truth.
  if v_order.payment_status = 'paid_inventory_issue' and v_attempt.status = 'captured' then
    return jsonb_build_object(
      'exceptional', true,
      'already_recorded', true,
      'order_id', v_order.id,
      'status', v_order.status,
      'payment_status', v_order.payment_status
    );
  end if;

  if v_attempt.status in ('failed', 'cancelled', 'refunded') then
    raise exception 'PAYMENT_ATTEMPT_NOT_ELIGIBLE_FOR_INVENTORY_EXCEPTION';
  end if;

  if v_attempt.provider_payment_id is not null
     and v_attempt.provider_payment_id <> p_provider_payment_id then
    raise exception 'PAYMENT_ID_MISMATCH';
  end if;

  if v_order.payment_status not in ('pending', 'paid_inventory_issue')
     or v_order.status <> 'pending_payment' then
    raise exception 'ORDER_NOT_ELIGIBLE_FOR_INVENTORY_EXCEPTION';
  end if;

  update public.payment_attempts
  set provider_payment_id = p_provider_payment_id,
      status = 'captured',
      signature_verified = true,
      provider_event_id = coalesce(p_provider_event_id, provider_event_id),
      failure_reason = 'Payment verified; inventory could not be finalized automatically.'
  where id = v_attempt.id;

  update public.orders
  set payment_status = 'paid_inventory_issue'
  where id = v_order.id
    and payment_status = 'pending';

  return jsonb_build_object(
    'exceptional', true,
    'already_recorded', false,
    'order_id', v_order.id,
    'status', v_order.status,
    'payment_status', 'paid_inventory_issue'
  );
end;
$$;
revoke all on function public.record_razorpay_inventory_exception(uuid, text, text) from public, anon, authenticated;

-- Payment-order creation remains reusable only for genuinely unpaid orders.
create or replace function public.prepare_payment_attempt(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_order public.orders;
  v_attempt public.payment_attempts;
begin
  if v_user_id is null then raise exception 'UNAUTHENTICATED'; end if;

  select * into v_order
  from public.orders
  where id = p_order_id
    and user_id = v_user_id
  for update;
  if v_order.id is null then raise exception 'ORDER_NOT_FOUND'; end if;

  if v_order.status <> 'pending_payment'
     or v_order.payment_status not in ('pending', 'failed') then
    raise exception 'ORDER_NOT_PAYABLE';
  end if;

  select * into v_attempt
  from public.payment_attempts
  where order_id = v_order.id
    and status in ('created','pending','authorized','captured')
  order by created_at desc
  limit 1;

  if v_attempt.id is null then
    insert into public.payment_attempts(order_id, amount, currency, status)
    values (v_order.id, v_order.grand_total, v_order.currency, 'created')
    returning * into v_attempt;
  end if;

  return jsonb_build_object(
    'attempt_id', v_attempt.id,
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'amount', v_order.grand_total,
    'currency', v_order.currency,
    'provider_order_id', v_attempt.provider_order_id,
    'attempt_status', v_attempt.status
  );
end;
$$;
revoke all on function public.prepare_payment_attempt(uuid) from public, anon, authenticated;
grant execute on function public.prepare_payment_attempt(uuid) to authenticated;
