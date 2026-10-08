create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  description text,
  image_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);
create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  created_at timestamptz not null default timezone('utc', now())
);
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories(id) on delete set null,
  brand_id uuid references public.brands(id) on delete set null,
  slug text not null unique,
  name text not null,
  description text,
  price numeric(12,2) not null check (price >= 0),
  original_price numeric(12,2) check (original_price is null or original_price >= price),
  rating numeric(2,1) not null default 0 check (rating between 0 and 5),
  review_count integer not null default 0 check (review_count >= 0),
  stock integer not null default 0 check (stock >= 0),
  image_url text,
  secondary_image_url text,
  tags text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
create index if not exists products_category_idx on public.products(category_id);
create index if not exists products_brand_idx on public.products(brand_id);
create index if not exists products_active_idx on public.products(is_active);
create table if not exists public.wishlists (
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, product_id)
);
alter table public.categories enable row level security;
alter table public.brands enable row level security;
alter table public.products enable row level security;
alter table public.wishlists enable row level security;
create policy "public_read_active_categories" on public.categories for select using (is_active = true);
create policy "public_read_brands" on public.brands for select using (true);
create policy "public_read_active_products" on public.products for select using (is_active = true);
create policy "wishlist_select_own" on public.wishlists for select to authenticated using (auth.uid() = user_id);
create policy "wishlist_insert_own" on public.wishlists for insert to authenticated with check (auth.uid() = user_id);
create policy "wishlist_delete_own" on public.wishlists for delete to authenticated using (auth.uid() = user_id);
create trigger products_set_updated_at before update on public.products for each row execute function public.set_updated_at();
