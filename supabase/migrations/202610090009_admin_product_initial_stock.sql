-- Admin-created products previously had no inventory row, so the storefront
-- (which reads availability from public.inventory) treated them as out of stock.

-- 1) Give every existing simple product (no variants) an inventory row.
insert into public.inventory (product_id, stock_quantity, reserved_quantity)
select p.id, 0, 0
from public.products p
where not exists (select 1 from public.inventory i where i.product_id = p.id)
  and not exists (select 1 from public.product_variants v where v.product_id = p.id);

-- 2) admin_create_product now accepts an initial stock and creates the inventory row.
drop function if exists public.admin_create_product(text,text,text,text,uuid,uuid,numeric,numeric,text,text[],text);

create or replace function public.admin_create_product(
  p_name text,p_slug text,p_description text,p_short_description text,p_brand_id uuid,p_category_id uuid,
  p_price numeric,p_compare_at_price numeric,p_sku text,p_tags text[],p_image_url text,
  p_initial_stock integer default 0
) returns public.products language plpgsql security definer set search_path=public
as $$
declare v_actor uuid:=public.require_admin_actor(); v_product public.products;
begin
  if nullif(trim(p_name),'') is null or char_length(trim(p_name))>200 then raise exception 'INVALID_PRODUCT_NAME'; end if;
  if p_slug is null or p_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then raise exception 'INVALID_PRODUCT_SLUG'; end if;
  if p_price is null or p_price < 0 then raise exception 'INVALID_PRODUCT_PRICE'; end if;
  if p_compare_at_price is not null and p_compare_at_price < p_price then raise exception 'INVALID_COMPARE_AT_PRICE'; end if;
  if p_sku is not null and (char_length(trim(p_sku)) < 1 or char_length(trim(p_sku)) > 100) then raise exception 'INVALID_PRODUCT_SKU'; end if;
  if p_initial_stock is null or p_initial_stock < 0 then raise exception 'INVALID_INITIAL_STOCK'; end if;
  if p_category_id is not null and not exists(select 1 from public.categories where id=p_category_id) then raise exception 'INVALID_CATEGORY'; end if;
  if p_brand_id is not null and not exists(select 1 from public.brands where id=p_brand_id) then raise exception 'INVALID_BRAND'; end if;
  insert into public.products(name,slug,description,short_description,brand_id,category_id,price,compare_at_price,sku,tags,image_url,is_active,status)
  values(trim(p_name),p_slug,p_description,p_short_description,p_brand_id,p_category_id,p_price,p_compare_at_price,nullif(trim(p_sku),''),coalesce(p_tags,'{}'),p_image_url,true,'active')
  returning * into v_product;
  insert into public.inventory(product_id,stock_quantity,reserved_quantity) values(v_product.id,p_initial_stock,0);
  insert into public.admin_audit_log(admin_user_id,operation_key,action,entity_type,entity_id,metadata)
  values(v_actor,'product:create:'||v_product.id::text,'product_created','product',v_product.id::text,
         jsonb_build_object('name',v_product.name,'sku',v_product.sku,'initial_stock',p_initial_stock));
  return v_product;
end;
$$;
revoke all on function public.admin_create_product(text,text,text,text,uuid,uuid,numeric,numeric,text,text[],text,integer) from public, anon;
grant execute on function public.admin_create_product(text,text,text,text,uuid,uuid,numeric,numeric,text,text[],text,integer) to authenticated;
