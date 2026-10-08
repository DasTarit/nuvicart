-- Phase 2: production catalog + commerce data foundation.
-- Evolves the Phase 1 catalog tables in place without duplicate production tables
-- and without destructive removal of existing wishlist references.

-- Categories
alter table public.categories
  add column if not exists sort_order integer not null default 0,
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

alter table public.categories
  drop constraint if exists categories_sort_order_check;
alter table public.categories
  add constraint categories_sort_order_check check (sort_order >= 0);

create index if not exists categories_active_sort_idx
  on public.categories(is_active, sort_order, name);

drop trigger if exists categories_set_updated_at on public.categories;
create trigger categories_set_updated_at
before update on public.categories
for each row execute function public.set_updated_at();

-- Brands
alter table public.brands
  add column if not exists description text,
  add column if not exists logo_url text,
  add column if not exists is_active boolean not null default true,
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

create index if not exists brands_active_idx on public.brands(is_active);

drop trigger if exists brands_set_updated_at on public.brands;
create trigger brands_set_updated_at
before update on public.brands
for each row execute function public.set_updated_at();

-- Products
alter table public.products
  add column if not exists short_description text,
  add column if not exists compare_at_price numeric(12,2),
  add column if not exists status text not null default 'active',
  add column if not exists is_featured boolean not null default false,
  add column if not exists sku text,
  add column if not exists legacy_id text;

-- Preserve the Phase 1 original_price data while introducing the
-- production field required by the catalog domain.
update public.products
set compare_at_price = original_price
where compare_at_price is null and original_price is not null;

alter table public.products
  drop constraint if exists products_compare_at_price_check;
alter table public.products
  add constraint products_compare_at_price_check
  check (compare_at_price is null or compare_at_price >= price);

alter table public.products
  drop constraint if exists products_status_check;
alter table public.products
  add constraint products_status_check
  check (status in ('draft', 'active', 'archived'));

alter table public.products
  drop constraint if exists products_legacy_id_format_check;
alter table public.products
  add constraint products_legacy_id_format_check
  check (legacy_id is null or char_length(trim(legacy_id)) between 1 and 100);

create unique index if not exists products_legacy_id_unique_idx
  on public.products(legacy_id)
  where legacy_id is not null;

alter table public.products
  drop constraint if exists products_sku_format_check;
alter table public.products
  add constraint products_sku_format_check
  check (sku is null or char_length(trim(sku)) between 1 and 100);

create unique index if not exists products_sku_unique_idx
  on public.products(sku)
  where sku is not null;

create index if not exists products_slug_idx on public.products(slug);
create index if not exists products_status_active_idx on public.products(status, is_active);
create index if not exists products_featured_idx on public.products(is_featured)
  where is_featured = true;

-- Existing Phase 1 `stock`, image fields and `original_price` remain temporarily
-- for compatibility. Production repository code does not treat them as
-- authoritative inventory/image sources.

-- Product images
create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  url text not null,
  alt_text text,
  sort_order integer not null default 0,
  is_primary boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint product_images_sort_order_check check (sort_order >= 0)
);

create unique index if not exists product_images_product_sort_unique_idx
  on public.product_images(product_id, sort_order);

create unique index if not exists product_images_one_primary_idx
  on public.product_images(product_id)
  where is_primary = true;

drop trigger if exists product_images_set_updated_at on public.product_images;
create trigger product_images_set_updated_at
before update on public.product_images
for each row execute function public.set_updated_at();

alter table public.product_images enable row level security;

drop policy if exists "public_read_active_product_images" on public.product_images;
create policy "public_read_active_product_images"
on public.product_images
for select
using (
  exists (
    select 1
    from public.products p
    where p.id = product_images.product_id
      and p.is_active = true
      and p.status = 'active'
  )
);

-- Product variants
create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  sku text not null,
  name text not null,
  option_values jsonb not null default '{}'::jsonb,
  price_override numeric(12,2),
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint product_variants_sku_check check (char_length(trim(sku)) between 1 and 100),
  constraint product_variants_price_override_check
    check (price_override is null or price_override >= 0)
);

create unique index if not exists product_variants_sku_unique_idx
  on public.product_variants(sku);
create index if not exists product_variants_product_idx
  on public.product_variants(product_id);
create index if not exists product_variants_active_idx
  on public.product_variants(product_id, is_active);

drop trigger if exists product_variants_set_updated_at on public.product_variants;
create trigger product_variants_set_updated_at
before update on public.product_variants
for each row execute function public.set_updated_at();

alter table public.product_variants enable row level security;

drop policy if exists "public_read_active_product_variants" on public.product_variants;
create policy "public_read_active_product_variants"
on public.product_variants
for select
using (
  is_active = true
  and exists (
    select 1
    from public.products p
    where p.id = product_variants.product_id
      and p.is_active = true
      and p.status = 'active'
  )
);

-- Inventory is deliberately not directly readable by the public client.
-- A security-definer RPC below returns only aggregate availability, not inventory rows.
create table if not exists public.inventory (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete cascade,
  variant_id uuid references public.product_variants(id) on delete cascade,
  stock_quantity integer not null default 0,
  reserved_quantity integer not null default 0,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint inventory_one_target_check
    check (((product_id is not null)::integer + (variant_id is not null)::integer) = 1),
  constraint inventory_stock_nonnegative_check check (stock_quantity >= 0),
  constraint inventory_reserved_nonnegative_check check (reserved_quantity >= 0),
  constraint inventory_reserved_not_above_stock_check
    check (reserved_quantity <= stock_quantity)
);

create unique index if not exists inventory_product_unique_idx
  on public.inventory(product_id);
create unique index if not exists inventory_variant_unique_idx
  on public.inventory(variant_id);
create index if not exists inventory_product_idx on public.inventory(product_id);
create index if not exists inventory_variant_idx on public.inventory(variant_id);

drop trigger if exists inventory_set_updated_at on public.inventory;
create trigger inventory_set_updated_at
before update on public.inventory
for each row execute function public.set_updated_at();

alter table public.inventory enable row level security;

-- No INSERT/UPDATE/DELETE/SELECT policies are granted to anon/authenticated.
-- Future trusted server/admin operations will use an explicitly privileged
-- server boundary.

-- Search across the production catalog without interpolating user input into SQL.
-- The parameter is passed to PostgreSQL as a bound function argument.
create or replace function public.search_catalog_product_ids(search_term text)
returns table(product_id uuid)
language sql
security invoker
stable
as $$
  select distinct p.id
  from public.products p
  left join public.brands b on b.id = p.brand_id
  left join public.categories c on c.id = p.category_id
  where p.is_active = true
    and p.status = 'active'
    and (
      p.name ilike '%' || search_term || '%'
      or coalesce(p.short_description, '') ilike '%' || search_term || '%'
      or coalesce(p.description, '') ilike '%' || search_term || '%'
      or coalesce(array_to_string(p.tags, ' '), '') ilike '%' || search_term || '%'
      or coalesce(b.name, '') ilike '%' || search_term || '%'
      or coalesce(c.name, '') ilike '%' || search_term || '%'
    )
  order by p.id;
$$;

revoke all on function public.search_catalog_product_ids(text) from public;
grant execute on function public.search_catalog_product_ids(text) to anon, authenticated;

-- Publicly expose only aggregate availability, never stock/reserved quantities.
create or replace function public.get_product_availability(product_ids uuid[])
returns table(product_id uuid, in_stock boolean, available_quantity integer)
language sql
security definer
set search_path = public
stable
as $$
  select p.id,
    coalesce(availability.available_quantity, 0) > 0 as in_stock,
    coalesce(availability.available_quantity, 0)::integer as available_quantity
  from public.products p
  left join lateral (
    select case
      when exists (
        select 1
        from public.product_variants v
        where v.product_id = p.id and v.is_active = true
      )
      then coalesce((
        select sum(greatest(i.stock_quantity - i.reserved_quantity, 0))
        from public.inventory i
        join public.product_variants v on v.id = i.variant_id
        where v.product_id = p.id and v.is_active = true
      ), 0)
      else coalesce((
        select greatest(i.stock_quantity - i.reserved_quantity, 0)
        from public.inventory i
        where i.product_id = p.id
      ), 0)
    end::integer as available_quantity
  ) availability on true
  where p.id = any(product_ids)
    and p.is_active = true
    and p.status = 'active';
$$;
revoke all on function public.get_product_availability(uuid[]) from public;
grant execute on function public.get_product_availability(uuid[]) to anon, authenticated;

-- Tighten existing public catalog policies to active production entities.
drop policy if exists "public_read_brands" on public.brands;
create policy "public_read_active_brands"
on public.brands
for select
using (is_active = true);

drop policy if exists "public_read_active_products" on public.products;
create policy "public_read_active_products"
on public.products
for select
using (is_active = true and status = 'active');

-- Read access is still constrained by the RLS policies above.
grant select on public.categories, public.brands, public.products to anon, authenticated;
grant select on public.product_images, public.product_variants to anon, authenticated;

-- Ensure RLS remains enabled for every catalog entity.
alter table public.categories enable row level security;
alter table public.brands enable row level security;
alter table public.products enable row level security;

-- Explicitly keep catalog administration out of client roles.
revoke insert, update, delete on public.categories from anon, authenticated;
revoke insert, update, delete on public.brands from anon, authenticated;
revoke insert, update, delete on public.products from anon, authenticated;
revoke insert, update, delete on public.product_images from anon, authenticated;
revoke insert, update, delete on public.product_variants from anon, authenticated;
revoke all on public.inventory from anon, authenticated;

-- Product detail/search indexes.
create index if not exists products_name_idx on public.products(name);
create index if not exists products_tags_idx on public.products using gin(tags);
