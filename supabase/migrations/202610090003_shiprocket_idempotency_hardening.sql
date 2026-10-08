-- Phase 5B.1: durable external Shiprocket operation identity and recovery state.
alter table public.fulfillments
  add column if not exists provider_operation_key text,
  add column if not exists provider_order_created_at timestamptz,
  add column if not exists provider_awb_assigned_at timestamptz,
  add column if not exists provider_last_checked_at timestamptz,
  add column if not exists provider_operation_status text;

alter table public.fulfillments drop constraint if exists fulfillments_provider_operation_status_check;
alter table public.fulfillments add constraint fulfillments_provider_operation_status_check
  check (provider_operation_status is null or provider_operation_status in ('none','order_creation_in_progress','provider_order_exists','awb_assignment_in_progress','shipment_completed','recovery_required'));
create unique index if not exists fulfillments_provider_operation_key_unique_idx
  on public.fulfillments(provider_operation_key) where provider_operation_key is not null;

create or replace function public.claim_shiprocket_creation(p_fulfillment_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid := public.require_fulfillment_operator(); v_f public.fulfillments; v_token uuid := gen_random_uuid(); v_stale interval := interval '5 minutes'; v_key text;
begin
 select * into v_f from public.fulfillments where id=p_fulfillment_id for update;
 if v_f.id is null then raise exception 'FULFILLMENT_NOT_FOUND'; end if;
 if v_f.status <> 'ready_to_ship' then raise exception 'FULFILLMENT_NOT_READY_TO_SHIP'; end if;
 if v_f.shipping_provider='shiprocket' and v_f.awb_code is not null then return jsonb_build_object('status','completed','fulfillment',to_jsonb(v_f)); end if;
 if v_f.shipping_processing_at is not null and v_f.shipping_processing_at > timezone('utc',now())-v_stale then return jsonb_build_object('status','in_progress','fulfillment',to_jsonb(v_f)); end if;
 v_key := coalesce(v_f.provider_operation_key,'nuvicart-fulfillment-'||v_f.id::text);
 update public.fulfillments set shipping_provider='shiprocket', provider_operation_key=v_key, shipping_processing_at=timezone('utc',now()), shipping_processing_token=v_token, shipping_error=null, provider_operation_status=case when provider_order_id is null then 'order_creation_in_progress' when awb_code is null then 'awb_assignment_in_progress' else 'shipment_completed' end where id=v_f.id;
 return jsonb_build_object('status','claimed','processing_token',v_token,'fulfillment_id',v_f.id,'provider_operation_key',v_key);
end; $$;
revoke all on function public.claim_shiprocket_creation(uuid) from public,anon; grant execute on function public.claim_shiprocket_creation(uuid) to authenticated;

create or replace function public.record_shiprocket_provider_order(p_fulfillment_id uuid,p_processing_token uuid,p_provider_order_id text,p_provider_shipment_id text)
returns public.fulfillments language plpgsql security definer set search_path=public as $$
declare v_f public.fulfillments; begin
 select * into v_f from public.fulfillments where id=p_fulfillment_id for update;
 if v_f.id is null then raise exception 'FULFILLMENT_NOT_FOUND'; end if;
 if v_f.shipping_processing_token is distinct from p_processing_token then raise exception 'STALE_SHIPPING_OPERATION'; end if;
 if v_f.provider_order_id is not null and v_f.provider_order_id<>p_provider_order_id then raise exception 'PROVIDER_ORDER_ID_CONFLICT'; end if;
 update public.fulfillments set shipping_provider='shiprocket',provider_order_id=p_provider_order_id,provider_shipment_id=coalesce(provider_shipment_id,p_provider_shipment_id),provider_order_created_at=coalesce(provider_order_created_at,timezone('utc',now())),provider_operation_status='provider_order_exists',provider_last_checked_at=timezone('utc',now()) where id=v_f.id returning * into v_f; return v_f;
end; $$;
revoke all on function public.record_shiprocket_provider_order(uuid,uuid,text,text) from public,anon; grant execute on function public.record_shiprocket_provider_order(uuid,uuid,text,text) to authenticated;

create or replace function public.complete_shiprocket_creation(p_fulfillment_id uuid,p_processing_token uuid,p_provider_order_id text,p_provider_shipment_id text,p_awb_code text,p_carrier text,p_label_url text)
returns public.fulfillments language plpgsql security definer set search_path=public as $$
declare v_f public.fulfillments; v_order public.orders; v_actor uuid:=public.require_fulfillment_operator(); v_now timestamptz:=timezone('utc',now());
begin
 select * into v_f from public.fulfillments where id=p_fulfillment_id for update; if v_f.id is null then raise exception 'FULFILLMENT_NOT_FOUND'; end if;
 if v_f.shipping_processing_token is distinct from p_processing_token then raise exception 'STALE_SHIPPING_OPERATION'; end if;
 if v_f.awb_code is not null then return v_f; end if; if v_f.status<>'ready_to_ship' then raise exception 'FULFILLMENT_NOT_READY_TO_SHIP'; end if;
 select * into v_order from public.orders where id=v_f.order_id for update; if v_order.status<>'processing' or v_order.payment_status<>'paid' then raise exception 'ORDER_NOT_SHIPPABLE'; end if;
 update public.fulfillments set shipping_provider='shiprocket',provider_order_id=coalesce(provider_order_id,p_provider_order_id),provider_shipment_id=coalesce(provider_shipment_id,p_provider_shipment_id),awb_code=p_awb_code,carrier=coalesce(p_carrier,'Shiprocket'),label_url=p_label_url,status='shipped',shipped_at=coalesce(shipped_at,v_now),provider_awb_assigned_at=coalesce(provider_awb_assigned_at,v_now),provider_last_checked_at=v_now,provider_operation_status='shipment_completed',shipping_processing_at=null,shipping_processing_token=null,shipping_error=null where id=v_f.id returning * into v_f;
 update public.orders set status='shipped' where id=v_order.id; insert into public.fulfillment_events(fulfillment_id,from_status,to_status,actor_user_id) values(v_f.id,'ready_to_ship','shipped',v_actor); return v_f;
end; $$;
revoke all on function public.complete_shiprocket_creation(uuid,uuid,text,text,text,text,text) from public,anon; grant execute on function public.complete_shiprocket_creation(uuid,uuid,text,text,text,text,text) to authenticated;

create or replace function public.release_shiprocket_creation(p_fulfillment_id uuid,p_processing_token uuid,p_error text)
returns public.fulfillments language plpgsql security definer set search_path=public as $$
declare v_f public.fulfillments; begin
 select * into v_f from public.fulfillments where id=p_fulfillment_id for update; if v_f.id is null then raise exception 'FULFILLMENT_NOT_FOUND'; end if; if v_f.shipping_processing_token is distinct from p_processing_token then raise exception 'STALE_SHIPPING_OPERATION'; end if;
 update public.fulfillments set shipping_processing_at=null,shipping_processing_token=null,shipping_error=left(coalesce(p_error,'SHIPROCKET_OPERATION_FAILED'),500),provider_operation_status=case when provider_order_id is not null and awb_code is null then 'recovery_required' else 'none' end,provider_last_checked_at=timezone('utc',now()) where id=v_f.id returning * into v_f; return v_f; end; $$;
revoke all on function public.release_shiprocket_creation(uuid,uuid,text) from public,anon; grant execute on function public.release_shiprocket_creation(uuid,uuid,text) to authenticated;
