-- Phase 5A: internal fulfillment engine + shipping foundation.
-- No external shipping provider integration is implemented here.

create table if not exists public.fulfillments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  status text not null default 'pending',
  carrier text,
  tracking_number text,
  shipping_method text,
  shipping_address_snapshot jsonb not null,
  shipped_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint fulfillments_status_check check (status in ('pending','processing','ready_to_ship','shipped','delivered','cancelled')),
  constraint fulfillments_shipped_fields_check check (
    status not in ('shipped','delivered') or (carrier is not null and tracking_number is not null and shipping_method is not null)
  ),
  constraint fulfillments_tracking_number_check check (tracking_number is null or char_length(trim(tracking_number)) between 1 and 120),
  constraint fulfillments_carrier_check check (carrier is null or char_length(trim(carrier)) between 1 and 80),
  constraint fulfillments_shipping_method_check check (shipping_method is null or char_length(trim(shipping_method)) between 1 and 80)
);

create index if not exists fulfillments_status_idx on public.fulfillments(status);
create index if not exists fulfillments_tracking_idx on public.fulfillments(carrier, tracking_number);
create index if not exists fulfillments_order_idx on public.fulfillments(order_id);

drop trigger if exists fulfillments_set_updated_at on public.fulfillments;
create trigger fulfillments_set_updated_at
before update on public.fulfillments
for each row execute function public.set_updated_at();

create table if not exists public.fulfillment_events (
  id uuid primary key default gen_random_uuid(),
  fulfillment_id uuid not null references public.fulfillments(id) on delete cascade,
  from_status text,
  to_status text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint fulfillment_events_to_status_check check (to_status in ('pending','processing','ready_to_ship','shipped','delivered','cancelled')),
  constraint fulfillment_events_from_status_check check (from_status is null or from_status in ('pending','processing','ready_to_ship','shipped','delivered','cancelled'))
);

create index if not exists fulfillment_events_fulfillment_idx
  on public.fulfillment_events(fulfillment_id, created_at);

create or replace function public.validate_fulfillment_status_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status <> old.status and not (
    (old.status = 'pending' and new.status in ('processing','cancelled')) or
    (old.status = 'processing' and new.status = 'ready_to_ship') or
    (old.status = 'ready_to_ship' and new.status = 'shipped') or
    (old.status = 'shipped' and new.status = 'delivered')
  ) then
    raise exception 'Invalid fulfillment status transition: % -> %', old.status, new.status;
  end if;
  return new;
end;
$$;

drop trigger if exists fulfillments_validate_status_transition on public.fulfillments;
create trigger fulfillments_validate_status_transition
before update on public.fulfillments
for each row execute function public.validate_fulfillment_status_transition();

alter table public.fulfillments enable row level security;
alter table public.fulfillment_events enable row level security;

-- Customers can read fulfillment/tracking only through their own order.
drop policy if exists "fulfillments_select_own" on public.fulfillments;
create policy "fulfillments_select_own"
on public.fulfillments for select to authenticated
using (
  exists (
    select 1 from public.orders o
    where o.id = fulfillments.order_id
      and o.user_id = auth.uid()
  )
);

drop policy if exists "fulfillment_events_select_own" on public.fulfillment_events;
create policy "fulfillment_events_select_own"
on public.fulfillment_events for select to authenticated
using (
  exists (
    select 1
    from public.fulfillments f
    join public.orders o on o.id = f.order_id
    where f.id = fulfillment_events.fulfillment_id
      and o.user_id = auth.uid()
  )
);

revoke all on public.fulfillments, public.fulfillment_events from anon;
grant select on public.fulfillments, public.fulfillment_events to authenticated;
revoke insert, update, delete on public.fulfillments, public.fulfillment_events from anon, authenticated;

-- Only trusted roles may mutate fulfillment. This is deliberately checked inside
-- SECURITY DEFINER functions so browser clients cannot bypass the server boundary.
create or replace function public.require_fulfillment_operator()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_role public.app_role;
begin
  if v_user_id is null then raise exception 'UNAUTHENTICATED'; end if;
  select role into v_role from public.profiles where user_id = v_user_id;
  if v_role not in ('admin','super_admin') then raise exception 'FORBIDDEN'; end if;
  return v_user_id;
end;
$$;
revoke all on function public.require_fulfillment_operator() from public, anon, authenticated;

create or replace function public.create_fulfillment_for_order(p_order_id uuid)
returns public.fulfillments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.require_fulfillment_operator();
  v_order public.orders;
  v_existing public.fulfillments;
  v_fulfillment public.fulfillments;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then raise exception 'ORDER_NOT_FOUND'; end if;

  if v_order.payment_status = 'paid_inventory_issue' then
    raise exception 'INVENTORY_EXCEPTION_REQUIRES_RESOLUTION';
  end if;
  if v_order.status <> 'paid' or v_order.payment_status <> 'paid' then
    raise exception 'ORDER_NOT_FULFILLABLE';
  end if;

  select * into v_existing from public.fulfillments where order_id = p_order_id for update;
  if v_existing.id is not null then
    return v_existing;
  end if;

  insert into public.fulfillments(order_id, status, shipping_address_snapshot)
  values (v_order.id, 'pending', v_order.shipping_address_snapshot)
  returning * into v_fulfillment;

  insert into public.fulfillment_events(fulfillment_id, from_status, to_status, actor_user_id)
  values (v_fulfillment.id, null, 'pending', v_actor);

  return v_fulfillment;
end;
$$;
revoke all on function public.create_fulfillment_for_order(uuid) from public, anon;
grant execute on function public.create_fulfillment_for_order(uuid) to authenticated;

create or replace function public.transition_fulfillment(
  p_fulfillment_id uuid,
  p_status text
)
returns public.fulfillments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.require_fulfillment_operator();
  v_fulfillment public.fulfillments;
  v_order public.orders;
  v_now timestamptz := timezone('utc', now());
  v_from_status text;
begin
  select * into v_fulfillment from public.fulfillments where id = p_fulfillment_id for update;
  if v_fulfillment.id is null then raise exception 'FULFILLMENT_NOT_FOUND'; end if;

  if p_status = v_fulfillment.status then
    return v_fulfillment;
  end if;

  select * into v_order from public.orders where id = v_fulfillment.order_id for update;

  if not (
    (v_fulfillment.status = 'pending' and p_status in ('processing','cancelled')) or
    (v_fulfillment.status = 'processing' and p_status = 'ready_to_ship') or
    (v_fulfillment.status = 'ready_to_ship' and p_status = 'shipped') or
    (v_fulfillment.status = 'shipped' and p_status = 'delivered')
  ) then
    raise exception 'INVALID_FULFILLMENT_STATUS_TRANSITION';
  end if;

  if p_status in ('processing','ready_to_ship','shipped','delivered') then
    if v_order.status = 'pending_payment' or v_order.payment_status <> 'paid' or v_order.status = 'cancelled' or v_order.status = 'refunded' then
      raise exception 'ORDER_NOT_FULFILLABLE';
    end if;
    if v_order.status = 'paid' and p_status = 'processing' then
      update public.orders set status = 'processing' where id = v_order.id;
    elsif v_order.status = 'processing' and p_status = 'shipped' then
      update public.orders set status = 'shipped' where id = v_order.id;
    elsif v_order.status = 'shipped' and p_status = 'delivered' then
      update public.orders set status = 'delivered' where id = v_order.id;
    end if;
  end if;

  v_from_status := v_fulfillment.status;

  update public.fulfillments
  set status = p_status,
      shipped_at = case when p_status = 'shipped' then coalesce(shipped_at, v_now) else shipped_at end,
      delivered_at = case when p_status = 'delivered' then coalesce(delivered_at, v_now) else delivered_at end,
      cancelled_at = case when p_status = 'cancelled' then coalesce(cancelled_at, v_now) else cancelled_at end
  where id = v_fulfillment.id
  returning * into v_fulfillment;

  if p_status = 'cancelled' and v_order.status = 'paid' then
    update public.orders set status = 'cancelled' where id = v_order.id;
  end if;

  insert into public.fulfillment_events(fulfillment_id, from_status, to_status, actor_user_id)
  values (v_fulfillment.id, v_from_status, p_status, v_actor);

  return v_fulfillment;
end;
$$;
revoke all on function public.transition_fulfillment(uuid,text) from public, anon;
grant execute on function public.transition_fulfillment(uuid,text) to authenticated;

-- Manual shipping assignment is the only Phase 5A shipping implementation.
-- It does not call an external provider.
create or replace function public.assign_manual_shipment(
  p_fulfillment_id uuid,
  p_carrier text,
  p_tracking_number text,
  p_shipping_method text
)
returns public.fulfillments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.require_fulfillment_operator();
  v_fulfillment public.fulfillments;
  v_order public.orders;
  v_now timestamptz := timezone('utc', now());
begin
  if nullif(trim(p_carrier), '') is null or nullif(trim(p_tracking_number), '') is null or nullif(trim(p_shipping_method), '') is null then
    raise exception 'INVALID_SHIPMENT_DATA';
  end if;

  select * into v_fulfillment from public.fulfillments where id = p_fulfillment_id for update;
  if v_fulfillment.id is null then raise exception 'FULFILLMENT_NOT_FOUND'; end if;
  if v_fulfillment.status <> 'ready_to_ship' then raise exception 'FULFILLMENT_NOT_READY_TO_SHIP'; end if;
  select * into v_order from public.orders where id = v_fulfillment.order_id for update;
  if v_order.payment_status <> 'paid' or v_order.status <> 'processing' then raise exception 'ORDER_NOT_SHIPPABLE'; end if;

  update public.fulfillments
  set carrier = trim(p_carrier), tracking_number = trim(p_tracking_number), shipping_method = trim(p_shipping_method),
      status = 'shipped', shipped_at = coalesce(shipped_at, v_now)
  where id = v_fulfillment.id
  returning * into v_fulfillment;

  update public.orders set status = 'shipped' where id = v_order.id;
  insert into public.fulfillment_events(fulfillment_id, from_status, to_status, actor_user_id)
  values (v_fulfillment.id, 'ready_to_ship', 'shipped', v_actor);

  return v_fulfillment;
end;
$$;
revoke all on function public.assign_manual_shipment(uuid,text,text,text) from public, anon;
grant execute on function public.assign_manual_shipment(uuid,text,text,text) to authenticated;

-- Protect direct table mutation even for privileged authenticated roles; all changes
-- go through the trusted functions above.
revoke insert, update, delete on public.fulfillments, public.fulfillment_events from authenticated;
