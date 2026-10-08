-- Phase 6: secure admin commerce operations.
-- No v2 commerce tables. Admin writes are security-definer, audited operations.

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users(id) on delete restrict,
  operation_key text,
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint admin_audit_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists admin_audit_operation_unique_idx
  on public.admin_audit_log(operation_key)
  where operation_key is not null;
create index if not exists admin_audit_created_idx on public.admin_audit_log(created_at desc);
create index if not exists admin_audit_actor_idx on public.admin_audit_log(admin_user_id, created_at desc);
create index if not exists admin_audit_entity_idx on public.admin_audit_log(entity_type, entity_id, created_at desc);

alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from anon, authenticated;
grant select on public.admin_audit_log to authenticated;

drop policy if exists "admin_audit_select_admin" on public.admin_audit_log;
create policy "admin_audit_select_admin"
on public.admin_audit_log for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.role in ('admin','super_admin')
  )
);

create or replace function public.require_admin_actor()
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_actor uuid := auth.uid(); v_role public.app_role;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED'; end if;
  select role into v_role from public.profiles where user_id = v_actor;
  if v_role not in ('admin','super_admin') then raise exception 'FORBIDDEN'; end if;
  return v_actor;
end;
$$;
revoke all on function public.require_admin_actor() from public, anon;
grant execute on function public.require_admin_actor() to authenticated;

create or replace function public.record_admin_audit(
  p_action text, p_entity_type text, p_entity_id text, p_metadata jsonb default '{}'::jsonb, p_operation_key text default null
) returns uuid language plpgsql security definer set search_path = public
as $$
declare v_actor uuid := public.require_admin_actor(); v_id uuid;
begin
  if p_action is null or length(trim(p_action)) = 0 or length(p_action) > 120 then raise exception 'INVALID_AUDIT_ACTION'; end if;
  if p_entity_type is null or length(trim(p_entity_type)) = 0 or length(p_entity_type) > 80 then raise exception 'INVALID_AUDIT_ENTITY'; end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then raise exception 'INVALID_AUDIT_METADATA'; end if;
  insert into public.admin_audit_log(admin_user_id,operation_key,action,entity_type,entity_id,metadata)
  values(v_actor, nullif(trim(p_operation_key),''), trim(p_action), trim(p_entity_type), p_entity_id, p_metadata)
  on conflict (operation_key) where operation_key is not null do nothing
  returning id into v_id;
  if v_id is null and p_operation_key is not null then select id into v_id from public.admin_audit_log where operation_key=p_operation_key; end if;
  return v_id;
end;
$$;
revoke all on function public.record_admin_audit(text,text,text,jsonb,text) from public, anon;
grant execute on function public.record_admin_audit(text,text,text,jsonb,text) to authenticated;

create or replace function public.admin_create_product(
  p_name text,p_slug text,p_description text,p_short_description text,p_brand_id uuid,p_category_id uuid,
  p_price numeric,p_compare_at_price numeric,p_sku text,p_tags text[],p_image_url text
) returns public.products language plpgsql security definer set search_path=public
as $$
declare v_actor uuid:=public.require_admin_actor(); v_product public.products;
begin
  if nullif(trim(p_name),'') is null or char_length(trim(p_name))>200 then raise exception 'INVALID_PRODUCT_NAME'; end if;
  if p_slug is null or p_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then raise exception 'INVALID_PRODUCT_SLUG'; end if;
  if p_price is null or p_price < 0 then raise exception 'INVALID_PRODUCT_PRICE'; end if;
  if p_compare_at_price is not null and p_compare_at_price < p_price then raise exception 'INVALID_COMPARE_AT_PRICE'; end if;
  if p_sku is not null and (char_length(trim(p_sku)) < 1 or char_length(trim(p_sku)) > 100) then raise exception 'INVALID_PRODUCT_SKU'; end if;
  if p_category_id is not null and not exists(select 1 from public.categories where id=p_category_id) then raise exception 'INVALID_CATEGORY'; end if;
  if p_brand_id is not null and not exists(select 1 from public.brands where id=p_brand_id) then raise exception 'INVALID_BRAND'; end if;
  insert into public.products(name,slug,description,short_description,brand_id,category_id,price,compare_at_price,sku,tags,image_url,is_active,status)
  values(trim(p_name),p_slug,p_description,p_short_description,p_brand_id,p_category_id,p_price,p_compare_at_price,nullif(trim(p_sku),''),coalesce(p_tags,'{}'),p_image_url,true,'active')
  returning * into v_product;
  insert into public.admin_audit_log(admin_user_id,operation_key,action,entity_type,entity_id,metadata)
  values(v_actor,'product:create:'||v_product.id::text,'product_created','product',v_product.id::text,jsonb_build_object('name',v_product.name,'sku',v_product.sku));
  return v_product;
end;
$$;

create or replace function public.admin_update_product(
  p_product_id uuid,p_name text,p_slug text,p_description text,p_short_description text,p_brand_id uuid,p_category_id uuid,
  p_price numeric,p_compare_at_price numeric,p_sku text,p_tags text[],p_image_url text,p_is_active boolean,p_status text
) returns public.products language plpgsql security definer set search_path=public
as $$
declare v_actor uuid:=public.require_admin_actor(); v_product public.products;
begin
  if p_name is null or nullif(trim(p_name),'') is null or char_length(trim(p_name))>200 then raise exception 'INVALID_PRODUCT_NAME'; end if;
  if p_slug is null or p_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then raise exception 'INVALID_PRODUCT_SLUG'; end if;
  if p_price is null or p_price < 0 then raise exception 'INVALID_PRODUCT_PRICE'; end if;
  if p_compare_at_price is not null and p_compare_at_price < p_price then raise exception 'INVALID_COMPARE_AT_PRICE'; end if;
  if p_status not in ('draft','active','archived') then raise exception 'INVALID_PRODUCT_STATUS'; end if;
  if p_category_id is not null and not exists(select 1 from public.categories where id=p_category_id) then raise exception 'INVALID_CATEGORY'; end if;
  if p_brand_id is not null and not exists(select 1 from public.brands where id=p_brand_id) then raise exception 'INVALID_BRAND'; end if;
  update public.products set name=trim(p_name),slug=p_slug,description=p_description,short_description=p_short_description,
    brand_id=p_brand_id,category_id=p_category_id,price=p_price,compare_at_price=p_compare_at_price,
    sku=nullif(trim(p_sku),''),tags=coalesce(p_tags,'{}'),image_url=p_image_url,is_active=p_is_active,status=p_status
  where id=p_product_id returning * into v_product;
  if v_product.id is null then raise exception 'PRODUCT_NOT_FOUND'; end if;
  insert into public.admin_audit_log(admin_user_id,operation_key,action,entity_type,entity_id,metadata)
  values(v_actor,'product:update:'||v_product.id::text||':'||v_product.updated_at::text,'product_updated','product',v_product.id::text,jsonb_build_object('name',v_product.name,'status',v_product.status));
  return v_product;
end;
$$;

create or replace function public.admin_archive_product(p_product_id uuid)
returns public.products language plpgsql security definer set search_path=public
as $$
declare v_actor uuid:=public.require_admin_actor(); v_product public.products;
begin
  update public.products set is_active=false,status='archived' where id=p_product_id returning * into v_product;
  if v_product.id is null then raise exception 'PRODUCT_NOT_FOUND'; end if;
  insert into public.admin_audit_log(admin_user_id,operation_key,action,entity_type,entity_id,metadata)
  values(v_actor,'product:archive:'||v_product.id::text,'product_archived','product',v_product.id::text,'{}'::jsonb)
  on conflict (operation_key) where operation_key is not null do nothing;
  return v_product;
end;
$$;

create or replace function public.admin_create_category(p_name text,p_slug text,p_description text,p_image_url text)
returns public.categories language plpgsql security definer set search_path=public
as $$
declare v_actor uuid:=public.require_admin_actor(); v_category public.categories;
begin
  if nullif(trim(p_name),'') is null or char_length(trim(p_name))>120 then raise exception 'INVALID_CATEGORY_NAME'; end if;
  if p_slug is null or p_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then raise exception 'INVALID_CATEGORY_SLUG'; end if;
  insert into public.categories(name,slug,description,image_url,is_active) values(trim(p_name),p_slug,p_description,p_image_url,true) returning * into v_category;
  insert into public.admin_audit_log(admin_user_id,operation_key,action,entity_type,entity_id,metadata)
  values(v_actor,'category:create:'||v_category.id::text,'category_created','category',v_category.id::text,jsonb_build_object('name',v_category.name));
  return v_category;
end;
$$;

create or replace function public.admin_update_category(p_category_id uuid,p_name text,p_slug text,p_description text,p_image_url text,p_is_active boolean)
returns public.categories language plpgsql security definer set search_path=public
as $$
declare v_actor uuid:=public.require_admin_actor(); v_category public.categories;
begin
  if nullif(trim(p_name),'') is null or char_length(trim(p_name))>120 then raise exception 'INVALID_CATEGORY_NAME'; end if;
  if p_slug is null or p_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then raise exception 'INVALID_CATEGORY_SLUG'; end if;
  if not p_is_active and exists(select 1 from public.products where category_id=p_category_id and is_active=true and status='active') then raise exception 'CATEGORY_IN_USE'; end if;
  update public.categories set name=trim(p_name),slug=p_slug,description=p_description,image_url=p_image_url,is_active=p_is_active where id=p_category_id returning * into v_category;
  if v_category.id is null then raise exception 'CATEGORY_NOT_FOUND'; end if;
  insert into public.admin_audit_log(admin_user_id,operation_key,action,entity_type,entity_id,metadata)
  values(v_actor,'category:update:'||v_category.id::text||':'||v_category.updated_at::text,'category_updated','category',v_category.id::text,jsonb_build_object('name',v_category.name,'is_active',v_category.is_active));
  return v_category;
end;
$$;

create or replace function public.admin_adjust_inventory(p_inventory_id uuid,p_delta integer,p_reason text)
returns public.inventory language plpgsql security definer set search_path=public
as $$
declare v_actor uuid:=public.require_admin_actor(); v_inventory public.inventory; v_previous integer; v_new integer;
begin
  if p_delta=0 or p_reason is null or char_length(trim(p_reason))<3 or char_length(trim(p_reason))>500 then raise exception 'INVALID_INVENTORY_ADJUSTMENT'; end if;
  select * into v_inventory from public.inventory where id=p_inventory_id for update;
  if v_inventory.id is null then raise exception 'INVENTORY_NOT_FOUND'; end if;
  v_previous:=v_inventory.stock_quantity; v_new:=v_previous+p_delta;
  if v_new < v_inventory.reserved_quantity then raise exception 'INVENTORY_BELOW_RESERVED'; end if;
  update public.inventory set stock_quantity=v_new where id=v_inventory.id returning * into v_inventory;
  insert into public.admin_audit_log(admin_user_id,operation_key,action,entity_type,entity_id,metadata)
  values(v_actor,'inventory:adjust:'||v_inventory.id::text||':'||v_inventory.updated_at::text,'inventory_adjusted','inventory',v_inventory.id::text,
    jsonb_build_object('previousQuantity',v_previous,'newQuantity',v_new,'delta',p_delta,'reason',trim(p_reason)));
  return v_inventory;
end;
$$;

create or replace function public.admin_cancel_order(p_order_id uuid,p_reason text)
returns public.orders language plpgsql security definer set search_path=public
as $$
declare v_actor uuid:=public.require_admin_actor(); v_order public.orders; v_from text;
begin
  if p_reason is null or char_length(trim(p_reason))<3 or char_length(trim(p_reason))>500 then raise exception 'INVALID_CANCELLATION_REASON'; end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if v_order.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status not in ('pending_payment','paid') then raise exception 'ORDER_NOT_CANCELLABLE'; end if;
  v_from:=v_order.status;
  update public.orders set status='cancelled' where id=v_order.id returning * into v_order;
  insert into public.admin_audit_log(admin_user_id,operation_key,action,entity_type,entity_id,metadata)
  values(v_actor,'order:cancel:'||v_order.id::text,'order_cancelled','order',v_order.id::text,jsonb_build_object('fromStatus',v_from,'reason',trim(p_reason)))
  on conflict (operation_key) where operation_key is not null do nothing;
  return v_order;
end;
$$;

revoke all on function public.admin_create_product(text,text,text,text,uuid,uuid,numeric,numeric,text,text[],text) from public, anon;
grant execute on function public.admin_create_product(text,text,text,text,uuid,uuid,numeric,numeric,text,text[],text) to authenticated;
revoke all on function public.admin_update_product(uuid,text,text,text,text,uuid,uuid,numeric,numeric,text,text[],text,boolean,text) from public, anon;
grant execute on function public.admin_update_product(uuid,text,text,text,text,uuid,uuid,numeric,numeric,text,text[],text,boolean,text) to authenticated;
revoke all on function public.admin_archive_product(uuid) from public, anon; grant execute on function public.admin_archive_product(uuid) to authenticated;
revoke all on function public.admin_create_category(text,text,text,text) from public, anon; grant execute on function public.admin_create_category(text,text,text,text) to authenticated;
revoke all on function public.admin_update_category(uuid,text,text,text,text,boolean) from public, anon; grant execute on function public.admin_update_category(uuid,text,text,text,text,boolean) to authenticated;
revoke all on function public.admin_adjust_inventory(uuid,integer,text) from public, anon; grant execute on function public.admin_adjust_inventory(uuid,integer,text) to authenticated;
revoke all on function public.admin_cancel_order(uuid,text) from public, anon; grant execute on function public.admin_cancel_order(uuid,text) to authenticated;

-- Keep catalog and inventory writes unavailable to browser clients.
revoke insert, update, delete on public.categories, public.brands, public.products, public.product_images, public.product_variants, public.inventory from anon, authenticated;

-- Make audit records immutable through the browser, including for admins.
revoke insert, update, delete on public.admin_audit_log from anon, authenticated;
