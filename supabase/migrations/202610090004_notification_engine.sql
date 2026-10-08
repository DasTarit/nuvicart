-- Phase 5C: durable transactional notification outbox + email delivery.
-- Notification delivery is downstream of authoritative order/payment/fulfillment state.

create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  user_id uuid not null references auth.users(id) on delete restrict,
  order_id uuid references public.orders(id) on delete restrict,
  event_type text not null,
  recipient_email text not null,
  payload jsonb not null,
  delivery_status text not null default 'pending',
  provider text,
  provider_message_id text,
  attempt_count integer not null default 0,
  last_attempted_at timestamptz,
  sent_at timestamptz,
  processing_at timestamptz,
  processing_token uuid,
  next_attempt_at timestamptz,
  failure_kind text,
  failure_code text,
  failure_reason text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint notification_events_type_check check (event_type in (
    'order_confirmation','payment_success','payment_failure','shipment_created',
    'shipment_tracking_updated','order_delivered','order_cancelled'
  )),
  constraint notification_events_status_check check (delivery_status in ('pending','processing','sent','failed')),
  constraint notification_events_failure_kind_check check (failure_kind is null or failure_kind in ('retryable','permanent','exhausted')),
  constraint notification_events_attempt_count_check check (attempt_count >= 0),
  constraint notification_events_recipient_check check (position('@' in recipient_email) > 1 and char_length(recipient_email) <= 320),
  constraint notification_events_payload_object_check check (jsonb_typeof(payload) = 'object')
);

create index if not exists notification_events_user_created_idx on public.notification_events(user_id, created_at desc);
create index if not exists notification_events_order_idx on public.notification_events(order_id, created_at desc);
create index if not exists notification_events_delivery_idx on public.notification_events(delivery_status, next_attempt_at, created_at);
create unique index if not exists notification_events_provider_message_unique_idx
  on public.notification_events(provider, provider_message_id)
  where provider_message_id is not null;

alter table public.notification_events enable row level security;
revoke all on public.notification_events from anon;
grant select on public.notification_events to authenticated;

drop policy if exists "notification_events_select_own" on public.notification_events;
create policy "notification_events_select_own"
on public.notification_events for select to authenticated
using (auth.uid() = user_id);

-- The browser never receives mutation privileges. Delivery mutation is server/service-role only.
revoke insert, update, delete on public.notification_events from anon, authenticated;

create or replace function public.set_notification_event_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = timezone('utc', now()); return new; end;
$$;
drop trigger if exists notification_events_set_updated_at on public.notification_events;
create trigger notification_events_set_updated_at before update on public.notification_events
for each row execute function public.set_notification_event_updated_at();

create or replace function public.notification_recipient_email(p_user_id uuid)
returns text language sql security definer stable set search_path = public, auth as $$
  select nullif(lower(trim(u.email)), '') from auth.users u where u.id = p_user_id;
$$;
revoke all on function public.notification_recipient_email(uuid) from public, anon, authenticated;

create or replace function public.notification_insert(
  p_event_key text,
  p_user_id uuid,
  p_order_id uuid,
  p_event_type text,
  p_recipient_email text,
  p_payload jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_user_id is null or p_event_key is null or p_event_type is null or p_recipient_email is null then return null; end if;
  insert into public.notification_events(event_key,user_id,order_id,event_type,recipient_email,payload,next_attempt_at)
  values(p_event_key,p_user_id,p_order_id,p_event_type,lower(trim(p_recipient_email)),p_payload,timezone('utc',now()))
  on conflict (event_key) do nothing
  returning id into v_id;
  if v_id is null then select id into v_id from public.notification_events where event_key=p_event_key; end if;
  return v_id;
end;
$$;
revoke all on function public.notification_insert(text,uuid,uuid,text,text,jsonb) from public, anon, authenticated;


create or replace function public.build_order_notification_payload(p_order_id uuid)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare v_order public.orders; v_items jsonb;
begin
  select * into v_order from public.orders where id=p_order_id;
  if v_order.id is null then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'productName', oi.product_name, 'sku', oi.sku, 'variantName', oi.variant_name,
    'variantSku', oi.variant_sku, 'unitPrice', oi.unit_price, 'quantity', oi.quantity,
    'lineSubtotal', oi.line_subtotal
  ) order by oi.created_at), '[]'::jsonb) into v_items from public.order_items oi where oi.order_id=v_order.id;
  return jsonb_build_object(
    'orderNumber',v_order.order_number,'status',v_order.status,'paymentStatus',v_order.payment_status,
    'currency',v_order.currency,'subtotal',v_order.subtotal,'discountTotal',v_order.discount_total,
    'shippingTotal',v_order.shipping_total,'taxTotal',v_order.tax_total,'grandTotal',v_order.grand_total,
    'shippingAddress',v_order.shipping_address_snapshot,'billingAddress',v_order.billing_address_snapshot,
    'items',v_items,'createdAt',v_order.created_at
  );
end;
$$;
revoke all on function public.build_order_notification_payload(uuid) from public, anon, authenticated;

create or replace function public.build_fulfillment_notification_payload(p_fulfillment_id uuid)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare v_f public.fulfillments; v_order public.orders;
begin
  select * into v_f from public.fulfillments where id=p_fulfillment_id;
  if v_f.id is null then return null; end if;
  select * into v_order from public.orders where id=v_f.order_id;
  if v_order.id is null then return null; end if;
  return jsonb_build_object(
    'orderNumber',v_order.order_number,'orderStatus',v_order.status,'paymentStatus',v_order.payment_status,
    'fulfillmentId',v_f.id,'fulfillmentStatus',v_f.status,'carrier',v_f.carrier,
    'trackingNumber',v_f.tracking_number,'shippingMethod',v_f.shipping_method,
    'shippingAddress',v_f.shipping_address_snapshot,'shippedAt',v_f.shipped_at,
    'deliveredAt',v_f.delivered_at,'cancelledAt',v_f.cancelled_at,
    'shippingProvider',v_f.shipping_provider,'providerShipmentId',v_f.provider_shipment_id
  );
end;
$$;
revoke all on function public.build_fulfillment_notification_payload(uuid) from public, anon, authenticated;

create or replace function public.notification_order_state_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_email text; v_payload jsonb;
begin
  v_email := public.notification_recipient_email(new.user_id);
  if v_email is null then return new; end if;
  v_payload := public.build_order_notification_payload(new.id);
  if tg_op = 'INSERT' then
    perform public.notification_insert(new.id::text || ':order_confirmation',new.user_id,new.id,'order_confirmation',v_email,v_payload);
    return new;
  end if;

  if old.payment_status is distinct from new.payment_status
     and new.payment_status='paid' then
    perform public.notification_insert(new.id::text || ':payment_success',new.user_id,new.id,'payment_success',v_email,v_payload);
  end if;
  if old.payment_status is distinct from new.payment_status
     and new.payment_status='failed' then
    perform public.notification_insert(new.id::text || ':payment_failure',new.user_id,new.id,'payment_failure',v_email,v_payload);
  end if;
  if old.status is distinct from new.status
     and new.status='cancelled' then
    perform public.notification_insert(new.id::text || ':order_cancelled',new.user_id,new.id,'order_cancelled',v_email,v_payload);
  end if;
  return new;
end;
$$;
drop trigger if exists orders_notification_event_trigger on public.orders;
create trigger orders_notification_event_trigger
after update of status, payment_status on public.orders
for each row execute function public.notification_order_state_trigger();

-- Checkout inserts order rows before order_items. Defer the confirmation trigger so
-- the immutable item snapshot is complete before the outbox event is built.
drop trigger if exists orders_notification_confirmation_trigger on public.orders;
create constraint trigger orders_notification_confirmation_trigger
after insert on public.orders
deferrable initially deferred
for each row execute function public.notification_order_state_trigger();

create or replace function public.notification_fulfillment_state_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_order public.orders; v_email text; v_payload jsonb;
begin
  select * into v_order from public.orders where id=new.order_id;
  if v_order.id is null then return new; end if;
  v_email := public.notification_recipient_email(v_order.user_id);
  if v_email is null then return new; end if;
  v_payload := public.build_fulfillment_notification_payload(new.id);
  if old.status <> new.status and new.status='shipped' then
    perform public.notification_insert(new.id::text || ':shipment_created',v_order.user_id,new.order_id,'shipment_created',v_email,v_payload);
  elsif old.status='shipped' and new.status='shipped' and (
    old.tracking_number is distinct from new.tracking_number or old.carrier is distinct from new.carrier or old.shipping_provider is distinct from new.shipping_provider
  ) then
    perform public.notification_insert(
      encode(digest(new.id::text || ':shipment_tracking_updated:' || coalesce(new.tracking_number,'') || ':' || coalesce(new.carrier,''),'sha256'),'hex'),
      v_order.user_id,new.order_id,'shipment_tracking_updated',v_email,v_payload
    );
  end if;
  if old.status <> new.status and new.status='delivered' then
    perform public.notification_insert(new.id::text || ':order_delivered',v_order.user_id,new.order_id,'order_delivered',v_email,v_payload);
  end if;
  return new;
end;
$$;
drop trigger if exists fulfillments_notification_event_trigger on public.fulfillments;
create trigger fulfillments_notification_event_trigger
after update of status, tracking_number, carrier, shipping_provider on public.fulfillments
for each row execute function public.notification_fulfillment_state_trigger();

-- Claim/recovery model mirrors the existing durable webhook/shipping patterns.
create or replace function public.claim_notification_delivery(p_event_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_e public.notification_events; v_token uuid:=gen_random_uuid(); v_now timestamptz:=timezone('utc',now());
begin
 select * into v_e from public.notification_events where id=p_event_id for update;
 if v_e.id is null then raise exception 'NOTIFICATION_NOT_FOUND'; end if;
 if v_e.delivery_status='sent' then return jsonb_build_object('status','sent','event',to_jsonb(v_e)); end if;
 if v_e.delivery_status='failed' and (v_e.failure_kind='permanent' or v_e.attempt_count >= 5) then return jsonb_build_object('status','failed','event',to_jsonb(v_e)); end if;
 if v_e.next_attempt_at is not null and v_e.next_attempt_at > v_now then return jsonb_build_object('status','deferred','event',to_jsonb(v_e)); end if;
 if v_e.delivery_status='processing' and v_e.processing_at is not null and v_e.processing_at > v_now-interval '5 minutes' then
   return jsonb_build_object('status','in_progress','event',to_jsonb(v_e));
 end if;
 update public.notification_events set delivery_status='processing', processing_at=v_now, processing_token=v_token, last_attempted_at=v_now, attempt_count=attempt_count+1, updated_at=v_now where id=v_e.id
 returning * into v_e;
 return jsonb_build_object('status','claimed','processing_token',v_token,'event',to_jsonb(v_e));
end;
$$;
revoke all on function public.claim_notification_delivery(uuid) from public, anon, authenticated;

create or replace function public.complete_notification_delivery(p_event_id uuid,p_processing_token uuid,p_provider text,p_provider_message_id text)
returns public.notification_events language plpgsql security definer set search_path=public as $$
declare v_e public.notification_events;
begin
 select * into v_e from public.notification_events where id=p_event_id for update;
 if v_e.id is null then raise exception 'NOTIFICATION_NOT_FOUND'; end if;
 if v_e.processing_token is distinct from p_processing_token then raise exception 'STALE_NOTIFICATION_WORKER'; end if;
 if v_e.delivery_status='sent' then return v_e; end if;
 update public.notification_events set delivery_status='sent',provider=p_provider,provider_message_id=p_provider_message_id,sent_at=timezone('utc',now()),processing_at=null,processing_token=null,next_attempt_at=null,failure_kind=null,failure_code=null,failure_reason=null where id=v_e.id returning * into v_e;
 return v_e;
end;
$$;
revoke all on function public.complete_notification_delivery(uuid,uuid,text,text) from public, anon, authenticated;

create or replace function public.fail_notification_delivery(p_event_id uuid,p_processing_token uuid,p_provider text,p_failure_kind text,p_failure_code text,p_failure_reason text)
returns public.notification_events language plpgsql security definer set search_path=public as $$
declare v_e public.notification_events; v_next timestamptz; v_kind text;
begin
 select * into v_e from public.notification_events where id=p_event_id for update;
 if v_e.id is null then raise exception 'NOTIFICATION_NOT_FOUND'; end if;
 if v_e.processing_token is distinct from p_processing_token then raise exception 'STALE_NOTIFICATION_WORKER'; end if;
 if p_failure_kind not in ('retryable','permanent') then raise exception 'INVALID_NOTIFICATION_FAILURE_KIND'; end if;
 v_kind := case when p_failure_kind='retryable' and v_e.attempt_count < 5 then 'retryable' else case when p_failure_kind='retryable' then 'exhausted' else 'permanent' end end;
 v_next := case when v_kind='retryable' then timezone('utc',now()) + make_interval(secs => least(3600, power(2, greatest(v_e.attempt_count-1,0))::integer * 30)) else null end;
 update public.notification_events set delivery_status=case when v_kind='retryable' then 'pending' else 'failed' end,provider=coalesce(p_provider,provider),processing_at=null,processing_token=null,next_attempt_at=v_next,failure_kind=v_kind,failure_code=left(p_failure_code,100),failure_reason=left(p_failure_reason,1000) where id=v_e.id returning * into v_e;
 return v_e;
end;
$$;
revoke all on function public.fail_notification_delivery(uuid,uuid,text,text,text,text) from public, anon, authenticated;

-- Server-side service role is the only delivery worker authority. Browser clients cannot claim/complete/fail.
comment on table public.notification_events is 'Phase 5C durable transactional notification outbox; downstream of authoritative business state and never authoritative for order/payment/fulfillment.';

drop policy if exists "notification_events_select_admin" on public.notification_events;
create policy "notification_events_select_admin"
on public.notification_events for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.role in ('admin','super_admin')
  )
);
