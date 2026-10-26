-- Admin product management: multiple images (min 2, any https host), full edit
-- (including total stock) and safe delete.

-- Validates and normalises a list of image links: trims, drops blanks/duplicates,
-- requires https:// (or a /path in public/), at least 2 and at most 10 images.
create or replace function public.clean_product_image_urls(p_urls text[])
returns text[] language plpgsql immutable
as $$
declare v_out text[] := '{}'; v_url text;
begin
  foreach v_url in array coalesce(p_urls, '{}') loop
    v_url := nullif(trim(v_url), '');
    if v_url is null then continue; end if;
    if char_length(v_url) > 2000
       or not (v_url ~* '^https://[^[:space:]]+$' or v_url ~ '^/[^[:space:]/][^[:space:]]*$') then
      raise exception 'INVALID_IMAGE_URL';
    end if;
    if not (v_url = any(v_out)) then v_out := v_out || v_url; end if;
  end loop;
  if coalesce(array_length(v_out, 1), 0) < 2 then raise exception 'PRODUCT_NEEDS_TWO_IMAGES'; end if;
  if array_length(v_out, 1) > 10 then raise exception 'TOO_MANY_IMAGES'; end if;
  return v_out;
end;
$$;

drop function if exists public.admin_create_product(text,text,text,text,uuid,uuid,numeric,numeric,text,text[],text);
drop function if exists public.admin_create_product(text,text,text,text,uuid,uuid,numeric,numeric,text,text[],text,integer);
drop function if exists public.admin_update_product(uuid,text,text,text,text,uuid,uuid,numeric,numeric,text,text[],text,boolean,text);

create or replace function public.admin_create_product(
  p_name text,p_slug text,p_description text,p_short_description text,p_brand_id uuid,p_category_id uuid,
  p_price numeric,p_compare_at_price numeric,p_sku text,p_tags text[],p_image_urls text[],
  p_initial_stock integer default 0
) returns public.products language plpgsql security definer set search_path=public
as $$
declare v_actor uuid:=public.require_admin_actor(); v_product public.products; v_urls text[];
begin
  if nullif(trim(p_name),'') is null or char_length(trim(p_name))>200 then raise exception 'INVALID_PRODUCT_NAME'; end if;
  if p_slug is null or p_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then raise exception 'INVALID_PRODUCT_SLUG'; end if;
  if p_price is null or p_price < 0 then raise exception 'INVALID_PRODUCT_PRICE'; end if;
  if p_compare_at_price is not null and p_compare_at_price < p_price then raise exception 'INVALID_COMPARE_AT_PRICE'; end if;
  if p_sku is not null and (char_length(trim(p_sku)) < 1 or char_length(trim(p_sku)) > 100) then raise exception 'INVALID_PRODUCT_SKU'; end if;
  if p_initial_stock is null or p_initial_stock < 0 then raise exception 'INVALID_INITIAL_STOCK'; end if;
  if p_category_id is not null and not exists(select 1 from public.categories where id=p_category_id) then raise exception 'INVALID_CATEGORY'; end if;
  if p_brand_id is not null and not exists(select 1 from public.brands where id=p_brand_id) then raise exception 'INVALID_BRAND'; end if;
  v_urls := public.clean_product_image_urls(p_image_urls);

  insert into public.products(name,slug,description,short_description,brand_id,category_id,price,compare_at_price,sku,tags,image_url,is_active,status)
  values(trim(p_name),p_slug,p_description,p_short_description,p_brand_id,p_category_id,p_price,p_compare_at_price,nullif(trim(p_sku),''),coalesce(p_tags,'{}'),v_urls[1],true,'active')
  returning * into v_product;

  insert into public.product_images(product_id,url,alt_text,sort_order,is_primary)
  select v_product.id, u, v_product.name, (ord-1)::integer, ord = 1 from unnest(v_urls) with ordinality as t(u, ord);

  insert into public.inventory(product_id,stock_quantity,reserved_quantity) values(v_product.id,p_initial_stock,0);

  insert into public.admin_audit_log(admin_user_id,operation_key,action,entity_type,entity_id,metadata)
  values(v_actor,'product:create:'||v_product.id::text,'product_created','product',v_product.id::text,
         jsonb_build_object('name',v_product.name,'sku',v_product.sku,'initial_stock',p_initial_stock,'images',array_length(v_urls,1)));
  return v_product;
end;
$$;

create or replace function public.admin_update_product(
  p_product_id uuid,p_name text,p_slug text,p_description text,p_short_description text,p_brand_id uuid,p_category_id uuid,
  p_price numeric,p_compare_at_price numeric,p_sku text,p_tags text[],p_image_urls text[],p_is_active boolean,p_status text,
  p_stock integer default null
) returns public.products language plpgsql security definer set search_path=public
as $$
declare
  v_actor uuid:=public.require_admin_actor(); v_product public.products; v_urls text[];
  v_inv public.inventory; v_prev_stock integer;
begin
  if nullif(trim(p_name),'') is null or char_length(trim(p_name))>200 then raise exception 'INVALID_PRODUCT_NAME'; end if;
  if p_slug is null or p_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then raise exception 'INVALID_PRODUCT_SLUG'; end if;
  if p_price is null or p_price < 0 then raise exception 'INVALID_PRODUCT_PRICE'; end if;
  if p_compare_at_price is not null and p_compare_at_price < p_price then raise exception 'INVALID_COMPARE_AT_PRICE'; end if;
  if p_sku is not null and (char_length(trim(p_sku)) < 1 or char_length(trim(p_sku)) > 100) then raise exception 'INVALID_PRODUCT_SKU'; end if;
  if p_status is null or p_status not in ('draft','active','archived') then raise exception 'INVALID_PRODUCT_STATUS'; end if;
  if p_stock is not null and p_stock < 0 then raise exception 'INVALID_STOCK'; end if;
  if p_category_id is not null and not exists(select 1 from public.categories where id=p_category_id) then raise exception 'INVALID_CATEGORY'; end if;
  if p_brand_id is not null and not exists(select 1 from public.brands where id=p_brand_id) then raise exception 'INVALID_BRAND'; end if;
  v_urls := public.clean_product_image_urls(p_image_urls);

  update public.products set name=trim(p_name),slug=p_slug,description=p_description,short_description=p_short_description,
    brand_id=p_brand_id,category_id=p_category_id,price=p_price,compare_at_price=p_compare_at_price,
    sku=nullif(trim(p_sku),''),tags=coalesce(p_tags,'{}'),image_url=v_urls[1],is_active=coalesce(p_is_active,true),status=p_status
  where id=p_product_id returning * into v_product;
  if v_product.id is null then raise exception 'PRODUCT_NOT_FOUND'; end if;

  delete from public.product_images where product_id=p_product_id;
  insert into public.product_images(product_id,url,alt_text,sort_order,is_primary)
  select p_product_id, u, v_product.name, (ord-1)::integer, ord = 1 from unnest(v_urls) with ordinality as t(u, ord);

  if p_stock is not null then
    if exists(select 1 from public.product_variants where product_id=p_product_id) then raise exception 'STOCK_MANAGED_BY_VARIANTS'; end if;
    select * into v_inv from public.inventory where product_id=p_product_id for update;
    if v_inv.id is null then
      insert into public.inventory(product_id,stock_quantity,reserved_quantity) values(p_product_id,p_stock,0);
      v_prev_stock := 0;
    else
      if p_stock < v_inv.reserved_quantity then raise exception 'STOCK_BELOW_RESERVED'; end if;
      v_prev_stock := v_inv.stock_quantity;
      update public.inventory set stock_quantity=p_stock where id=v_inv.id;
    end if;
  end if;

  insert into public.admin_audit_log(admin_user_id,operation_key,action,entity_type,entity_id,metadata)
  values(v_actor,'product:update:'||v_product.id::text||':'||v_product.updated_at::text,'product_updated','product',v_product.id::text,
         jsonb_build_object('name',v_product.name,'status',v_product.status,'images',array_length(v_urls,1),
                            'previous_stock',v_prev_stock,'new_stock',p_stock))
  on conflict (operation_key) where operation_key is not null do nothing;
  return v_product;
end;
$$;

-- Delete a product. Products that appear in past orders (or are used by a promotion) are
-- archived instead, so order history, refunds and cancellations keep working.
create or replace function public.admin_delete_product(p_product_id uuid)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_actor uuid:=public.require_admin_actor(); v_product public.products; v_archived boolean:=false;
begin
  select * into v_product from public.products where id=p_product_id for update;
  if v_product.id is null then raise exception 'PRODUCT_NOT_FOUND'; end if;

  if exists(select 1 from public.order_items where product_id=p_product_id) then
    v_archived := true;
  else
    begin
      delete from public.products where id=p_product_id;
    exception when foreign_key_violation then
      v_archived := true;
    end;
  end if;

  if v_archived then
    update public.products set is_active=false,status='archived' where id=p_product_id;
  end if;

  insert into public.admin_audit_log(admin_user_id,operation_key,action,entity_type,entity_id,metadata)
  values(v_actor,'product:'||case when v_archived then 'archive' else 'delete' end||':'||p_product_id::text,
         case when v_archived then 'product_archived' else 'product_deleted' end,'product',p_product_id::text,
         jsonb_build_object('name',v_product.name,'sku',v_product.sku))
  on conflict (operation_key) where operation_key is not null do nothing;
  return jsonb_build_object('deleted', not v_archived, 'archived', v_archived);
end;
$$;

revoke all on function public.clean_product_image_urls(text[]) from public, anon;
revoke all on function public.admin_create_product(text,text,text,text,uuid,uuid,numeric,numeric,text,text[],text[],integer) from public, anon;
grant execute on function public.admin_create_product(text,text,text,text,uuid,uuid,numeric,numeric,text,text[],text[],integer) to authenticated;
revoke all on function public.admin_update_product(uuid,text,text,text,text,uuid,uuid,numeric,numeric,text,text[],text[],boolean,text,integer) from public, anon;
grant execute on function public.admin_update_product(uuid,text,text,text,text,uuid,uuid,numeric,numeric,text,text[],text[],boolean,text,integer) to authenticated;
revoke all on function public.admin_delete_product(uuid) from public, anon;
grant execute on function public.admin_delete_product(uuid) to authenticated;
-- clean_product_image_urls is called from security-definer functions owned by the same role.

notify pgrst, 'reload schema';
