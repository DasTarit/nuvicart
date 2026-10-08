-- Phase 5B: Shiprocket integration behind the existing fulfillment/provider boundary.
-- No payment, inventory, refund, split-shipment, or order-creation redesign.

alter table public.fulfillments
  add column if not exists shipping_provider text,
  add column if not exists provider_order_id text,
  add column if not exists provider_shipment_id text,
  add column if not exists awb_code text,
  add column if not exists label_url text,
  add column if not exists shipping_error text,
  add column if not exists shipping_processing_at timestamptz,
  add column if not exists shipping_processing_token uuid;

alter table public.fulfillments
  drop constraint if exists fulfillments_shipping_provider_check;
alter table public.fulfillments
  add constraint fulfillments_shipping_provider_check check (shipping_provider is null or shipping_provider in ('manual','shiprocket'));

create unique index if not exists fulfillments_provider_order_unique_idx
  on public.fulfillments(shipping_provider, provider_order_id)
  where provider_order_id is not null;
create unique index if not exists fulfillments_provider_shipment_unique_idx
  on public.fulfillments(shipping_provider, provider_shipment_id)
  where provider_shipment_id is not null;
create unique index if not exists fulfillments_awb_unique_idx
  on public.fulfillments(shipping_provider, awb_code)
  where awb_code is not null;

create table if not exists public.shipping_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  payload jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  processed_at timestamptz,
  constraint shipping_webhook_events_provider_check check (provider in ('shiprocket')),
  constraint shipping_webhook_events_provider_event_unique unique(provider, provider_event_id)
);
create index if not exists shipping_webhook_events_created_idx on public.shipping_webhook_events(created_at desc);
alter table public.shipping_webhook_events enable row level security;
revoke all on public.shipping_webhook_events from anon, authenticated;

-- Claim a single Shiprocket creation operation. The five-minute stale rule makes
-- crashed workers recoverable without allowing two live workers to create concurrently.
create or replace function public.claim_shiprocket_creation(p_fulfillment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.require_fulfillment_operator();
  v_f public.fulfillments;
  v_token uuid := gen_random_uuid();
  v_stale interval := interval '5 minutes';
begin
  select * into v_f from public.fulfillments where id = p_fulfillment_id for update;
  if v_f.id is null then raise exception 'FULFILLMENT_NOT_FOUND'; end if;
  if v_f.status <> 'ready_to_ship' then raise exception 'FULFILLMENT_NOT_READY_TO_SHIP'; end if;
  if v_f.shipping_provider = 'shiprocket' and v_f.awb_code is not null then
    return jsonb_build_object('status','completed','fulfillment',to_jsonb(v_f));
  end if;
  if v_f.shipping_processing_at is not null and v_f.shipping_processing_at > timezone('utc', now()) - v_stale then
    return jsonb_build_object('status','in_progress','fulfillment',to_jsonb(v_f));
  end if;
  update public.fulfillments
  set shipping_provider = 'shiprocket', shipping_processing_at = timezone('utc', now()), shipping_processing_token = v_token, shipping_error = null
  where id = v_f.id;
  return jsonb_build_object('status','claimed','processing_token',v_token,'fulfillment_id',v_f.id);
end;
$$;
revoke all on function public.claim_shiprocket_creation(uuid) from public, anon;
grant execute on function public.claim_shiprocket_creation(uuid) to authenticated;

create or replace function public.complete_shiprocket_creation(
  p_fulfillment_id uuid,
  p_processing_token uuid,
  p_provider_order_id text,
  p_provider_shipment_id text,
  p_awb_code text,
  p_carrier text,
  p_label_url text
)
returns public.fulfillments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.require_fulfillment_operator();
  v_f public.fulfillments;
  v_order public.orders;
  v_now timestamptz := timezone('utc', now());
begin
  select * into v_f from public.fulfillments where id = p_fulfillment_id for update;
  if v_f.id is null then raise exception 'FULFILLMENT_NOT_FOUND'; end if;
  if v_f.shipping_processing_token is distinct from p_processing_token then raise exception 'STALE_SHIPPING_OPERATION'; end if;
  if v_f.awb_code is not null then return v_f; end if;
  if v_f.status <> 'ready_to_ship' then raise exception 'FULFILLMENT_NOT_READY_TO_SHIP'; end if;
  select * into v_order from public.orders where id = v_f.order_id for update;
  if v_order.status <> 'processing' or v_order.payment_status <> 'paid' then raise exception 'ORDER_NOT_SHIPPABLE'; end if;
  update public.fulfillments set shipping_provider='shiprocket', provider_order_id=p_provider_order_id, provider_shipment_id=p_provider_shipment_id, awb_code=p_awb_code, carrier=coalesce(p_carrier,'Shiprocket'), label_url=p_label_url, status='shipped', shipped_at=coalesce(shipped_at,v_now), shipping_processing_at=null, shipping_processing_token=null, shipping_error=null where id=v_f.id returning * into v_f;
  update public.orders set status='shipped' where id=v_order.id;
  insert into public.fulfillment_events(fulfillment_id,from_status,to_status,actor_user_id) values(v_f.id,'ready_to_ship','shipped',v_actor);
  return v_f;
end;
$$;
revoke all on function public.complete_shiprocket_creation(uuid,uuid,text,text,text,text,text) from public, anon;
grant execute on function public.complete_shiprocket_creation(uuid,uuid,text,text,text,text,text) to authenticated;

create or replace function public.release_shiprocket_creation(p_fulfillment_id uuid, p_processing_token uuid, p_error text)
returns public.fulfillments
language plpgsql
security definer
set search_path = public
as $$
declare v_f public.fulfillments; v_actor uuid := public.require_fulfillment_operator();
begin
  select * into v_f from public.fulfillments where id=p_fulfillment_id for update;
  if v_f.id is null then raise exception 'FULFILLMENT_NOT_FOUND'; end if;
  if v_f.shipping_processing_token is distinct from p_processing_token then raise exception 'STALE_SHIPPING_OPERATION'; end if;
  update public.fulfillments set shipping_processing_at=null, shipping_processing_token=null, shipping_error=left(coalesce(p_error,'SHIPROCKET_OPERATION_FAILED'),500) where id=v_f.id returning * into v_f;
  return v_f;
end;
$$;
revoke all on function public.release_shiprocket_creation(uuid,uuid,text) from public, anon;
grant execute on function public.release_shiprocket_creation(uuid,uuid,text) to authenticated;

create or replace function public.record_shiprocket_webhook(
  p_provider_event_id text,
  p_payload jsonb,
  p_awb text,
  p_provider_order_id text,
  p_provider_shipment_id text,
  p_status text,
  p_carrier text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.shipping_webhook_events;
  v_f public.fulfillments;
  v_target text;
  v_from text;
begin
  if p_provider_event_id is null or length(trim(p_provider_event_id)) < 1 then raise exception 'INVALID_PROVIDER_EVENT_ID'; end if;
  insert into public.shipping_webhook_events(provider,provider_event_id,payload) values('shiprocket',p_provider_event_id,p_payload)
  on conflict (provider,provider_event_id) do nothing;
  select * into v_event from public.shipping_webhook_events where provider='shiprocket' and provider_event_id=p_provider_event_id for update;
  if v_event.processed_at is not null then return jsonb_build_object('status','processed'); end if;
  select * into v_f from public.fulfillments where shipping_provider='shiprocket' and (awb_code=p_awb or provider_order_id=p_provider_order_id or provider_shipment_id=p_provider_shipment_id) limit 1 for update;
  if v_f.id is null then raise exception 'FULFILLMENT_NOT_FOUND'; end if;
  v_from := v_f.status;
  v_target := case when upper(coalesce(p_status,'')) in ('DELIVERED','DELIVERED_TO_CUSTOMER') then 'delivered' when upper(coalesce(p_status,'')) in ('CANCELLED','CANCELED') then 'cancelled' else 'shipped' end;
  if v_target = 'delivered' then
    if v_f.status = 'shipped' then
      update public.fulfillments set status='delivered', delivered_at=coalesce(delivered_at,timezone('utc',now())), carrier=coalesce(p_carrier,carrier), awb_code=coalesce(p_awb,awb_code) where id=v_f.id;
      update public.orders set status='delivered' where id=v_f.order_id;
      insert into public.fulfillment_events(fulfillment_id,from_status,to_status,actor_user_id) values(v_f.id,'shipped','delivered',null);
    elsif v_f.status <> 'delivered' then
      raise exception 'INVALID_PROVIDER_STATE_TRANSITION';
    end if;
  elsif v_target = 'cancelled' then
    if v_f.status in ('pending','processing','ready_to_ship') then
      update public.fulfillments set status='cancelled', cancelled_at=coalesce(cancelled_at,timezone('utc',now())) where id=v_f.id;
      update public.orders set status='cancelled' where id=v_f.order_id;
      insert into public.fulfillment_events(fulfillment_id,from_status,to_status,actor_user_id) values(v_f.id,v_from,'cancelled',null);
    elsif v_f.status <> 'cancelled' then raise exception 'INVALID_PROVIDER_STATE_TRANSITION'; end if;
  else
    if v_f.status in ('ready_to_ship','shipped') then
      update public.fulfillments set status='shipped', shipped_at=coalesce(shipped_at,timezone('utc',now())), carrier=coalesce(p_carrier,carrier), awb_code=coalesce(p_awb,awb_code) where id=v_f.id;
      if v_f.status = 'ready_to_ship' then update public.orders set status='shipped' where id=v_f.order_id; insert into public.fulfillment_events(fulfillment_id,from_status,to_status,actor_user_id) values(v_f.id,'ready_to_ship','shipped',null); end if;
    else raise exception 'INVALID_PROVIDER_STATE_TRANSITION'; end if;
  end if;
  update public.shipping_webhook_events set processed_at=timezone('utc',now()) where id=v_event.id;
  return jsonb_build_object('status','processed');
end;
$$;
revoke all on function public.record_shiprocket_webhook(text,jsonb,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.record_shiprocket_webhook(text,jsonb,text,text,text,text,text) to service_role;
