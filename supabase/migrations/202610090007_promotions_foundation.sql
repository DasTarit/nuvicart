-- Phase 7B: server-authoritative promotions and discount engine.
-- One promotion per order. Promotion redemption is reserved atomically with order creation;
-- failed payment retries remain tied to the same order and do not consume another redemption. Payment retry reuses this order redemption.

create table if not exists public.promotions (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  description text,
  discount_type text not null,
  discount_value numeric(12,2) not null,
  minimum_order_value numeric(12,2),
  maximum_discount numeric(12,2),
  starts_at timestamptz not null,
  expires_at timestamptz,
  usage_limit integer,
  usage_count integer not null default 0,
  per_customer_limit integer,
  active boolean not null default true,
  restriction_type text not null default 'all',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint promotions_discount_type_check check (discount_type in ('percentage','fixed_amount')),
  constraint promotions_discount_value_check check (discount_value > 0),
  constraint promotions_percentage_value_check check (discount_type <> 'percentage' or discount_value <= 100),
  constraint promotions_minimum_check check (minimum_order_value is null or minimum_order_value >= 0),
  constraint promotions_maximum_check check (maximum_discount is null or maximum_discount > 0),
  constraint promotions_usage_limit_check check (usage_limit is null or usage_limit > 0),
  constraint promotions_usage_count_check check (usage_count >= 0 and (usage_limit is null or usage_count <= usage_limit)),
  constraint promotions_per_customer_limit_check check (per_customer_limit is null or per_customer_limit > 0),
  constraint promotions_dates_check check (expires_at is null or expires_at > starts_at),
  constraint promotions_restriction_type_check check (restriction_type in ('all','products','categories')),
  constraint promotions_code_check check (code = upper(trim(code)) and char_length(code) between 1 and 64),
  constraint promotions_name_check check (char_length(trim(name)) between 1 and 160)
);
create unique index if not exists promotions_code_unique_idx on public.promotions(code);
create index if not exists promotions_active_dates_idx on public.promotions(active, starts_at, expires_at);
create index if not exists promotions_created_idx on public.promotions(created_at desc);
drop trigger if exists promotions_set_updated_at on public.promotions;
create trigger promotions_set_updated_at before update on public.promotions for each row execute function public.set_updated_at();

create table if not exists public.promotion_products (
  promotion_id uuid not null references public.promotions(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (promotion_id, product_id)
);
create index if not exists promotion_products_product_idx on public.promotion_products(product_id, promotion_id);

create table if not exists public.promotion_categories (
  promotion_id uuid not null references public.promotions(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (promotion_id, category_id)
);
create index if not exists promotion_categories_category_idx on public.promotion_categories(category_id, promotion_id);

create table if not exists public.promotion_redemptions (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.promotions(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  status text not null default 'reserved',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint promotion_redemptions_status_check check (status in ('reserved','consumed')),
  constraint promotion_redemptions_order_unique check (order_id is not null)
);
create unique index if not exists promotion_redemptions_order_unique_idx on public.promotion_redemptions(order_id);
create unique index if not exists promotion_redemptions_promotion_user_order_unique_idx on public.promotion_redemptions(promotion_id, user_id, order_id);
create index if not exists promotion_redemptions_customer_idx on public.promotion_redemptions(promotion_id, user_id, created_at desc);
create index if not exists promotion_redemptions_promotion_idx on public.promotion_redemptions(promotion_id, created_at desc);
drop trigger if exists promotion_redemptions_set_updated_at on public.promotion_redemptions;
create trigger promotion_redemptions_set_updated_at before update on public.promotion_redemptions for each row execute function public.set_updated_at();

alter table public.promotions enable row level security;
alter table public.promotion_products enable row level security;
alter table public.promotion_categories enable row level security;
alter table public.promotion_redemptions enable row level security;
revoke all on public.promotions, public.promotion_products, public.promotion_categories, public.promotion_redemptions from anon, authenticated;

alter table public.orders add column if not exists promotion_id uuid references public.promotions(id) on delete restrict;
alter table public.orders add column if not exists promotion_code_snapshot text;
create index if not exists orders_promotion_idx on public.orders(promotion_id) where promotion_id is not null;

-- Resolve and calculate a promotion against authoritative cart line snapshots.
-- p_lock=true is used only by final order creation, where the promotion row is locked for
-- concurrency-safe usage enforcement. Preview never owns or consumes a redemption.
create or replace function public.calculate_promotion_for_lines(
  p_code text,
  p_user_id uuid,
  p_subtotal numeric,
  p_lines jsonb,
  p_lock boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(trim(coalesce(p_code, '')));
  v_promotion public.promotions;
  v_now timestamptz := now();
  v_eligible numeric(12,2) := 0;
  v_discount numeric(12,2) := 0;
  v_customer_usage integer := 0;
  v_line record;
  v_allowed boolean;
begin
  if p_user_id is null then raise exception 'UNAUTHENTICATED'; end if;
  if v_code = '' then return jsonb_build_object('valid',false,'code',v_code,'reason','PROMOTION_CODE_REQUIRED','promotionId',null,'eligibleSubtotal',0,'discountAmount',0); end if;

  if p_lock then
    select * into v_promotion from public.promotions where code = v_code for update;
  else
    select * into v_promotion from public.promotions where code = v_code;
  end if;
  if v_promotion.id is null then return jsonb_build_object('valid',false,'code',v_code,'reason','PROMOTION_NOT_FOUND','promotionId',null,'eligibleSubtotal',0,'discountAmount',0); end if;
  if not v_promotion.active then return jsonb_build_object('valid',false,'code',v_code,'reason','PROMOTION_INACTIVE','promotionId',v_promotion.id,'eligibleSubtotal',0,'discountAmount',0); end if;
  if v_now < v_promotion.starts_at then return jsonb_build_object('valid',false,'code',v_code,'reason','PROMOTION_NOT_STARTED','promotionId',v_promotion.id,'eligibleSubtotal',0,'discountAmount',0); end if;
  if v_promotion.expires_at is not null and v_now >= v_promotion.expires_at then return jsonb_build_object('valid',false,'code',v_code,'reason','PROMOTION_EXPIRED','promotionId',v_promotion.id,'eligibleSubtotal',0,'discountAmount',0); end if;
  if v_promotion.usage_limit is not null and v_promotion.usage_count >= v_promotion.usage_limit then return jsonb_build_object('valid',false,'code',v_code,'reason','PROMOTION_USAGE_LIMIT_REACHED','promotionId',v_promotion.id,'eligibleSubtotal',0,'discountAmount',0); end if;

  select count(*) into v_customer_usage from public.promotion_redemptions r where r.promotion_id = v_promotion.id and r.user_id = p_user_id and r.status in ('reserved','consumed');
  if v_promotion.per_customer_limit is not null and v_customer_usage >= v_promotion.per_customer_limit then
    return jsonb_build_object('valid',false,'code',v_code,'reason','PROMOTION_CUSTOMER_LIMIT_REACHED','promotionId',v_promotion.id,'eligibleSubtotal',0,'discountAmount',0);
  end if;

  for v_line in select * from jsonb_to_recordset(coalesce(p_lines, '[]'::jsonb)) as x(product_id uuid, variant_id uuid, line_subtotal numeric(12,2)) loop
    v_allowed := case
      when v_promotion.restriction_type = 'all' then true
      when v_promotion.restriction_type = 'products' then exists(select 1 from public.promotion_products pp where pp.promotion_id=v_promotion.id and pp.product_id=v_line.product_id)
      when v_promotion.restriction_type = 'categories' then exists(select 1 from public.promotion_categories pc join public.products p on p.id=v_line.product_id where pc.promotion_id=v_promotion.id and pc.category_id=p.category_id)
      else false
    end;
    if v_allowed then v_eligible := (v_eligible + greatest(coalesce(v_line.line_subtotal,0),0))::numeric(12,2); end if;
  end loop;

  if v_promotion.minimum_order_value is not null and p_subtotal < v_promotion.minimum_order_value then
    return jsonb_build_object('valid',false,'code',v_code,'reason','PROMOTION_MINIMUM_ORDER_NOT_MET','promotionId',v_promotion.id,'eligibleSubtotal',v_eligible,'discountAmount',0,'minimumOrderValue',v_promotion.minimum_order_value,'maximumDiscount',v_promotion.maximum_discount);
  end if;
  if v_eligible <= 0 then
    return jsonb_build_object('valid',false,'code',v_code,'reason','PROMOTION_NOT_ELIGIBLE_FOR_CART','promotionId',v_promotion.id,'eligibleSubtotal',0,'discountAmount',0,'minimumOrderValue',v_promotion.minimum_order_value,'maximumDiscount',v_promotion.maximum_discount);
  end if;

  if v_promotion.discount_type = 'percentage' then v_discount := (v_eligible * v_promotion.discount_value / 100)::numeric(12,2);
  else v_discount := v_promotion.discount_value::numeric(12,2);
  end if;
  if v_promotion.maximum_discount is not null then v_discount := least(v_discount, v_promotion.maximum_discount); end if;
  v_discount := greatest(least(v_discount, v_eligible), 0)::numeric(12,2);

  return jsonb_build_object('valid',true,'code',v_code,'reason',null,'promotionId',v_promotion.id,'eligibleSubtotal',v_eligible,'discountAmount',v_discount,'minimumOrderValue',v_promotion.minimum_order_value,'maximumDiscount',v_promotion.maximum_discount);
end;
$$;
revoke all on function public.calculate_promotion_for_lines(text,uuid,numeric,jsonb,boolean) from public, anon, authenticated;

-- Server-side preview. No browser subtotal or customer identity is trusted.
create or replace function public.validate_promotion_for_cart(p_code text)
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
  v_line numeric(12,2);
  v_subtotal numeric(12,2) := 0;
  v_lines jsonb := '[]'::jsonb;
begin
  if v_user_id is null then raise exception 'UNAUTHENTICATED'; end if;
  select id into v_cart_id from public.carts where user_id=v_user_id;
  if v_cart_id is null then raise exception 'EMPTY_CART'; end if;
  for v_item in select ci.product_id,ci.variant_id,ci.quantity from public.cart_items ci where ci.cart_id=v_cart_id order by ci.created_at loop
    select * into v_product from public.products p where p.id=v_item.product_id and p.is_active=true and p.status='active';
    if v_product.id is null then raise exception 'UNAVAILABLE_PRODUCT'; end if;
    v_variant := null;
    if v_item.variant_id is not null then select * into v_variant from public.product_variants pv where pv.id=v_item.variant_id and pv.product_id=v_item.product_id and pv.is_active=true; if v_variant.id is null then raise exception 'UNAVAILABLE_VARIANT'; end if;
    elsif exists(select 1 from public.product_variants pv where pv.product_id=v_product.id and pv.is_active=true) then raise exception 'VARIANT_REQUIRED'; end if;
    v_unit_price := case when v_variant.id is not null then coalesce(v_variant.price_override,v_product.price) else v_product.price end;
    v_line := (v_unit_price * v_item.quantity)::numeric(12,2); v_subtotal := (v_subtotal+v_line)::numeric(12,2);
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('product_id',v_product.id,'variant_id',v_variant.id,'line_subtotal',v_line));
  end loop;
  return public.calculate_promotion_for_lines(p_code,v_user_id,v_subtotal,v_lines,false);
end;
$$;
revoke all on function public.validate_promotion_for_cart(text) from public, anon;
grant execute on function public.validate_promotion_for_cart(text) to authenticated;

-- Final authoritative order creation. This replaces the existing Phase 4A.2 function in place
-- and adds only an optional promotion code; the two-argument compatibility wrapper remains.
create or replace function public.create_order_from_cart(
  p_address_id uuid,
  p_idempotency_key text,
  p_promotion_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid(); v_cart_id uuid; v_order_id uuid; v_order_number text; v_existing public.orders; v_address public.customer_addresses;
  v_subtotal numeric(12,2):=0; v_discount_total numeric(12,2):=0; v_shipping_total numeric(12,2):=0; v_tax_total numeric(12,2):=0; v_grand_total numeric(12,2):=0;
  v_item_count integer:=0; v_cart_item record; v_product public.products; v_variant public.product_variants; v_unit_price numeric(12,2); v_available integer; v_line_subtotal numeric(12,2);
  v_line_snapshots jsonb:='[]'::jsonb; v_address_snapshot jsonb; v_order public.orders; v_promotion_quote jsonb; v_promotion_id uuid; v_promotion_code text;
begin
  if v_user_id is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9._:-]{16,128}$' then raise exception 'INVALID_IDEMPOTENCY_KEY'; end if;
  select * into v_existing from public.orders where user_id=v_user_id and idempotency_key=p_idempotency_key;
  if v_existing.id is not null then return jsonb_build_object('existing',true,'order_id',v_existing.id,'order_number',v_existing.order_number,'status',v_existing.status,'payment_status',v_existing.payment_status,'currency',v_existing.currency,'subtotal',v_existing.subtotal,'discount_total',v_existing.discount_total,'shipping_total',v_existing.shipping_total,'tax_total',v_existing.tax_total,'grand_total',v_existing.grand_total,'promotion_id',v_existing.promotion_id,'promotion_code',v_existing.promotion_code_snapshot,'item_count',coalesce((select sum(oi.quantity) from public.order_items oi where oi.order_id=v_existing.id),0)); end if;
  select * into v_address from public.customer_addresses where id=p_address_id and user_id=v_user_id; if v_address.id is null then raise exception 'INVALID_ADDRESS'; end if;
  select id into v_cart_id from public.carts where user_id=v_user_id for update; if v_cart_id is null then raise exception 'EMPTY_CART'; end if;
  if not exists(select 1 from public.cart_items where cart_id=v_cart_id) then raise exception 'EMPTY_CART'; end if;
  for v_cart_item in select ci.id,ci.product_id,ci.variant_id,ci.quantity from public.cart_items ci where ci.cart_id=v_cart_id order by ci.created_at for update loop
    if v_cart_item.quantity<1 or v_cart_item.quantity>999 then raise exception 'INVALID_QUANTITY'; end if;
    select * into v_product from public.products p where p.id=v_cart_item.product_id and p.is_active=true and p.status='active'; if v_product.id is null then raise exception 'UNAVAILABLE_PRODUCT'; end if;
    v_variant:=null;
    if v_cart_item.variant_id is not null then select * into v_variant from public.product_variants pv where pv.id=v_cart_item.variant_id and pv.product_id=v_cart_item.product_id and pv.is_active=true; if v_variant.id is null then raise exception 'UNAVAILABLE_VARIANT'; end if;
    elsif exists(select 1 from public.product_variants pv where pv.product_id=v_product.id and pv.is_active=true) then raise exception 'VARIANT_REQUIRED'; end if;
    if v_variant.id is not null then v_unit_price:=coalesce(v_variant.price_override,v_product.price)::numeric(12,2); select greatest(i.stock_quantity-i.reserved_quantity,0) into v_available from public.inventory i where i.variant_id=v_variant.id;
    else v_unit_price:=v_product.price::numeric(12,2); select greatest(i.stock_quantity-i.reserved_quantity,0) into v_available from public.inventory i where i.product_id=v_product.id; end if;
    v_available:=coalesce(v_available,0); if v_cart_item.quantity>v_available then raise exception 'INSUFFICIENT_STOCK'; end if;
    v_line_subtotal:=(v_unit_price*v_cart_item.quantity)::numeric(12,2); v_subtotal:=(v_subtotal+v_line_subtotal)::numeric(12,2); v_item_count:=v_item_count+v_cart_item.quantity;
    v_line_snapshots:=v_line_snapshots||jsonb_build_array(jsonb_build_object('product_id',v_product.id,'variant_id',v_variant.id,'product_name',v_product.name,'sku',v_product.sku,'variant_name',v_variant.name,'variant_sku',v_variant.sku,'unit_price',v_unit_price,'quantity',v_cart_item.quantity,'line_subtotal',v_line_subtotal));
  end loop;
  if nullif(trim(p_promotion_code),'') is not null then
    v_promotion_quote:=public.calculate_promotion_for_lines(p_promotion_code,v_user_id,v_subtotal,v_line_snapshots,true);
    if coalesce((v_promotion_quote->>'valid')::boolean,false) is not true then raise exception '%',coalesce(v_promotion_quote->>'reason','PROMOTION_INVALID'); end if;
    v_discount_total:=coalesce((v_promotion_quote->>'discountAmount')::numeric,0)::numeric(12,2); v_promotion_id:=(v_promotion_quote->>'promotionId')::uuid; v_promotion_code:=v_promotion_quote->>'code';
  end if;
  v_grand_total:=(v_subtotal-v_discount_total+v_shipping_total+v_tax_total)::numeric(12,2); if v_discount_total<0 or v_discount_total>v_subtotal or v_grand_total<0 then raise exception 'INVALID_DISCOUNT_TOTAL'; end if;
  v_address_snapshot:=jsonb_build_object('full_name',v_address.full_name,'phone',v_address.phone,'address_line_1',v_address.address_line_1,'address_line_2',v_address.address_line_2,'landmark',v_address.landmark,'city',v_address.city,'state',v_address.state,'postal_code',v_address.postal_code,'country',v_address.country);
  v_order_number:='NUV-'||to_char(timezone('utc',now()),'YYYY')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
  insert into public.orders(user_id,order_number,status,payment_status,currency,subtotal,discount_total,shipping_total,tax_total,grand_total,billing_address_snapshot,shipping_address_snapshot,idempotency_key,promotion_id,promotion_code_snapshot) values(v_user_id,v_order_number,'pending_payment','pending','INR',v_subtotal,v_discount_total,v_shipping_total,v_tax_total,v_grand_total,v_address_snapshot,v_address_snapshot,p_idempotency_key,v_promotion_id,v_promotion_code) returning * into v_order;
  insert into public.order_items(order_id,product_id,variant_id,product_name,sku,variant_name,variant_sku,unit_price,quantity,line_subtotal) select v_order.id,line.product_id,line.variant_id,line.product_name,line.sku,line.variant_name,line.variant_sku,line.unit_price,line.quantity,line.line_subtotal from jsonb_to_recordset(v_line_snapshots) as line(product_id uuid,variant_id uuid,product_name text,sku text,variant_name text,variant_sku text,unit_price numeric(12,2),quantity integer,line_subtotal numeric(12,2));
  if v_promotion_id is not null then
    insert into public.promotion_redemptions(promotion_id,user_id,order_id,status) values(v_promotion_id,v_user_id,v_order.id,'reserved');
    update public.promotions set usage_count=usage_count+1 where id=v_promotion_id;
  end if;
  delete from public.cart_items where cart_id=v_cart_id;
  return jsonb_build_object('existing',false,'order_id',v_order.id,'order_number',v_order.order_number,'status',v_order.status,'payment_status',v_order.payment_status,'currency',v_order.currency,'subtotal',v_order.subtotal,'discount_total',v_order.discount_total,'shipping_total',v_order.shipping_total,'tax_total',v_order.tax_total,'grand_total',v_order.grand_total,'promotion_id',v_order.promotion_id,'promotion_code',v_order.promotion_code_snapshot,'item_count',v_item_count);
exception when unique_violation then
  select * into v_existing from public.orders where user_id=v_user_id and idempotency_key=p_idempotency_key;
  if v_existing.id is not null then return jsonb_build_object('existing',true,'order_id',v_existing.id,'order_number',v_existing.order_number,'status',v_existing.status,'payment_status',v_existing.payment_status,'currency',v_existing.currency,'subtotal',v_existing.subtotal,'discount_total',v_existing.discount_total,'shipping_total',v_existing.shipping_total,'tax_total',v_existing.tax_total,'grand_total',v_existing.grand_total,'promotion_id',v_existing.promotion_id,'promotion_code',v_existing.promotion_code_snapshot,'item_count',coalesce((select sum(oi.quantity) from public.order_items oi where oi.order_id=v_existing.id),0)); end if; raise;
end;
$$;
revoke all on function public.create_order_from_cart(uuid,text,text) from public, anon; grant execute on function public.create_order_from_cart(uuid,text,text) to authenticated;

create or replace function public.create_order_from_cart(p_address_id uuid,p_idempotency_key text)
returns jsonb language sql security definer set search_path=public as $$ select public.create_order_from_cart(p_address_id,p_idempotency_key,null); $$;
revoke all on function public.create_order_from_cart(uuid,text) from public, anon; grant execute on function public.create_order_from_cart(uuid,text) to authenticated;

-- Controlled admin CRUD. Role checks happen inside SQL as a second authorization boundary.
create or replace function public.assert_admin_role() returns void language plpgsql security definer set search_path=public as $$ begin if not exists(select 1 from public.profiles where user_id=auth.uid() and role in ('admin','super_admin')) then raise exception 'FORBIDDEN'; end if; end; $$;
revoke all on function public.assert_admin_role() from public,anon,authenticated;


create or replace function public.admin_create_promotion(
  p_code text,p_name text,p_description text,p_discount_type text,p_discount_value numeric,p_minimum_order_value numeric,
  p_maximum_discount numeric,p_starts_at timestamptz,p_expires_at timestamptz,p_usage_limit integer,p_per_customer_limit integer,
  p_restriction_type text,p_product_ids uuid[],p_category_ids uuid[],p_active boolean
)
returns public.promotions
language plpgsql security definer set search_path=public as $$
declare v_p public.promotions; v_code text:=upper(trim(p_code)); v_id uuid;
begin
  perform public.assert_admin_role();
  if p_restriction_type='products' and coalesce(array_length(p_product_ids,1),0)=0 then raise exception 'PROMOTION_PRODUCTS_REQUIRED'; end if;
  if p_restriction_type='categories' and coalesce(array_length(p_category_ids,1),0)=0 then raise exception 'PROMOTION_CATEGORIES_REQUIRED'; end if;
  if p_discount_type='percentage' and p_discount_value>100 then raise exception 'PROMOTION_PERCENTAGE_TOO_HIGH'; end if;
  insert into public.promotions(code,name,description,discount_type,discount_value,minimum_order_value,maximum_discount,starts_at,expires_at,usage_limit,per_customer_limit,restriction_type,active)
  values(v_code,trim(p_name),p_description,p_discount_type,p_discount_value,p_minimum_order_value,p_maximum_discount,p_starts_at,p_expires_at,p_usage_limit,p_per_customer_limit,p_restriction_type,p_active) returning * into v_p;
  if p_restriction_type='products' then insert into public.promotion_products(promotion_id,product_id) select v_p.id,x from unnest(p_product_ids) x; end if;
  if p_restriction_type='categories' then insert into public.promotion_categories(promotion_id,category_id) select v_p.id,x from unnest(p_category_ids) x; end if;
  perform public.record_admin_audit('promotion_created','promotion',v_p.id::text,jsonb_build_object('code',v_p.code,'discount_type',v_p.discount_type,'restriction_type',v_p.restriction_type),'promotion:create:'||v_p.id::text);
  return v_p;
end; $$;
revoke all on function public.admin_create_promotion(text,text,text,text,numeric,numeric,numeric,timestamptz,timestamptz,integer,integer,text,uuid[],uuid[],boolean) from public,anon;
grant execute on function public.admin_create_promotion(text,text,text,text,numeric,numeric,numeric,timestamptz,timestamptz,integer,integer,text,uuid[],uuid[],boolean) to authenticated;

create or replace function public.admin_update_promotion(
  p_promotion_id uuid,p_code text,p_name text,p_description text,p_discount_type text,p_discount_value numeric,p_minimum_order_value numeric,
  p_maximum_discount numeric,p_starts_at timestamptz,p_expires_at timestamptz,p_usage_limit integer,p_per_customer_limit integer,
  p_restriction_type text,p_product_ids uuid[],p_category_ids uuid[],p_active boolean
)
returns public.promotions
language plpgsql security definer set search_path=public as $$
declare v_p public.promotions; v_old public.promotions; v_code text:=upper(trim(p_code)); v_action text;
begin
  perform public.assert_admin_role();
  select * into v_old from public.promotions where id=p_promotion_id for update; if v_old.id is null then raise exception 'PROMOTION_NOT_FOUND'; end if;
  if p_restriction_type='products' and coalesce(array_length(p_product_ids,1),0)=0 then raise exception 'PROMOTION_PRODUCTS_REQUIRED'; end if;
  if p_restriction_type='categories' and coalesce(array_length(p_category_ids,1),0)=0 then raise exception 'PROMOTION_CATEGORIES_REQUIRED'; end if;
  if p_discount_type='percentage' and p_discount_value>100 then raise exception 'PROMOTION_PERCENTAGE_TOO_HIGH'; end if;
  update public.promotions set code=v_code,name=trim(p_name),description=p_description,discount_type=p_discount_type,discount_value=p_discount_value,minimum_order_value=p_minimum_order_value,maximum_discount=p_maximum_discount,starts_at=p_starts_at,expires_at=p_expires_at,usage_limit=p_usage_limit,per_customer_limit=p_per_customer_limit,restriction_type=p_restriction_type,active=p_active where id=p_promotion_id returning * into v_p;
  delete from public.promotion_products where promotion_id=v_p.id; delete from public.promotion_categories where promotion_id=v_p.id;
  if p_restriction_type='products' then insert into public.promotion_products(promotion_id,product_id) select v_p.id,x from unnest(p_product_ids) x; end if;
  if p_restriction_type='categories' then insert into public.promotion_categories(promotion_id,category_id) select v_p.id,x from unnest(p_category_ids) x; end if;
  v_action:=case when v_old.active is distinct from v_p.active then case when v_p.active then 'promotion_activated' else 'promotion_deactivated' end else 'promotion_updated' end;
  perform public.record_admin_audit(v_action,'promotion',v_p.id::text,jsonb_build_object('code',v_p.code,'discount_type',v_p.discount_type,'restriction_type',v_p.restriction_type,'active',v_p.active),'promotion:update:'||v_p.id::text||':'||extract(epoch from v_p.updated_at)::text);
  return v_p;
end; $$;
revoke all on function public.admin_update_promotion(uuid,text,text,text,text,numeric,numeric,numeric,timestamptz,timestamptz,integer,integer,text,uuid[],uuid[],boolean) from public,anon;
grant execute on function public.admin_update_promotion(uuid,text,text,text,text,numeric,numeric,numeric,timestamptz,timestamptz,integer,integer,text,uuid[],uuid[],boolean) to authenticated;

comment on table public.promotion_redemptions is 'One order-linked promotion reservation. Failed payment retries remain on the same order; cancellation does not restore usage in Phase 7B.';
comment on column public.orders.promotion_code_snapshot is 'Historical normalized promotion code used for this order; never reconstructed from current promotion state.';
