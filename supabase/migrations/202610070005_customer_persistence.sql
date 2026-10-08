-- Phase 3: customer persistence + account data foundation.
-- Evolves the existing profiles/wishlist foundation and adds addresses/carts.
-- No checkout, order, payment, fulfillment, or inventory mutation is included.

-- Customer addresses
create table if not exists public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  full_name text not null,
  phone text not null,
  address_line_1 text not null,
  address_line_2 text,
  landmark text,
  city text not null,
  state text not null,
  postal_code text not null,
  country text not null default 'India',
  is_default boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint customer_addresses_label_check check (char_length(trim(label)) between 1 and 40),
  constraint customer_addresses_full_name_check check (char_length(trim(full_name)) between 2 and 100),
  constraint customer_addresses_phone_check check (char_length(trim(phone)) between 7 and 30),
  constraint customer_addresses_line1_check check (char_length(trim(address_line_1)) between 3 and 200),
  constraint customer_addresses_line2_check check (address_line_2 is null or char_length(trim(address_line_2)) <= 200),
  constraint customer_addresses_landmark_check check (landmark is null or char_length(trim(landmark)) <= 120),
  constraint customer_addresses_city_check check (char_length(trim(city)) between 2 and 80),
  constraint customer_addresses_state_check check (char_length(trim(state)) between 2 and 80),
  constraint customer_addresses_postal_check check (
    (upper(trim(country)) = 'INDIA' and trim(postal_code) ~ '^[0-9]{6}$')
    or (upper(trim(country)) <> 'INDIA' and char_length(trim(postal_code)) between 2 and 20)
  ),
  constraint customer_addresses_country_check check (char_length(trim(country)) between 2 and 80)
);

create index if not exists customer_addresses_user_idx
  on public.customer_addresses(user_id);

create unique index if not exists customer_addresses_one_default_idx
  on public.customer_addresses(user_id)
  where is_default = true;

drop trigger if exists customer_addresses_set_updated_at on public.customer_addresses;
create trigger customer_addresses_set_updated_at
before update on public.customer_addresses
for each row execute function public.set_updated_at();

alter table public.customer_addresses enable row level security;

drop policy if exists "customer_addresses_select_own" on public.customer_addresses;
create policy "customer_addresses_select_own"
on public.customer_addresses for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "customer_addresses_insert_own" on public.customer_addresses;
create policy "customer_addresses_insert_own"
on public.customer_addresses for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "customer_addresses_update_own" on public.customer_addresses;
create policy "customer_addresses_update_own"
on public.customer_addresses for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "customer_addresses_delete_own" on public.customer_addresses;
create policy "customer_addresses_delete_own"
on public.customer_addresses for delete to authenticated
using (auth.uid() = user_id);

revoke all on public.customer_addresses from anon;
grant select, insert, update, delete on public.customer_addresses to authenticated;

create or replace function public.set_default_customer_address(p_address_id uuid)
returns public.customer_addresses
language plpgsql
security invoker
set search_path = public
as $$
declare
  target public.customer_addresses;
begin
  select * into target
  from public.customer_addresses
  where id = p_address_id
    and user_id = auth.uid()
  for update;

  if target.id is null then
    raise exception 'Address not found';
  end if;

  update public.customer_addresses
  set is_default = false
  where user_id = auth.uid()
    and id <> p_address_id
    and is_default = true;

  update public.customer_addresses
  set is_default = true
  where id = p_address_id
    and user_id = auth.uid()
  returning * into target;

  return target;
end;
$$;

revoke all on function public.set_default_customer_address(uuid) from public, anon;
grant execute on function public.set_default_customer_address(uuid) to authenticated;

-- Wishlist: Phase 1 already created the table/policies. Reinforce ownership
-- and grants without adding an update path.
alter table public.wishlists enable row level security;
revoke all on public.wishlists from anon;
grant select, insert, delete on public.wishlists to authenticated;

-- Persistent authenticated carts
create table if not exists public.carts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  variant_id uuid references public.product_variants(id) on delete cascade,
  quantity integer not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint cart_items_quantity_check check (quantity >= 1)
);

create unique index if not exists cart_items_identity_idx
  on public.cart_items(cart_id, product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid));

create index if not exists carts_user_idx on public.carts(user_id);
create index if not exists cart_items_cart_idx on public.cart_items(cart_id);
create index if not exists cart_items_product_idx on public.cart_items(product_id);
create index if not exists cart_items_variant_idx on public.cart_items(variant_id);

drop trigger if exists carts_set_updated_at on public.carts;
create trigger carts_set_updated_at
before update on public.carts
for each row execute function public.set_updated_at();

drop trigger if exists cart_items_set_updated_at on public.cart_items;
create trigger cart_items_set_updated_at
before update on public.cart_items
for each row execute function public.set_updated_at();

create or replace function public.validate_cart_item_variant()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.variant_id is not null and not exists (
    select 1
    from public.product_variants v
    where v.id = new.variant_id
      and v.product_id = new.product_id
      and v.is_active = true
  ) then
    raise exception 'Cart item variant is invalid or inactive';
  end if;

  if new.variant_id is null and exists (
    select 1
    from public.product_variants v
    where v.product_id = new.product_id
      and v.is_active = true
  ) then
    raise exception 'Cart item variant is required for products with active variants';
  end if;

  if not exists (
    select 1
    from public.products p
    where p.id = new.product_id
      and p.is_active = true
      and p.status = 'active'
  ) then
    raise exception 'Cart item product is invalid or inactive';
  end if;

  return new;
end;
$$;

drop trigger if exists cart_items_validate_product_variant on public.cart_items;
create trigger cart_items_validate_product_variant
before insert or update on public.cart_items
for each row execute function public.validate_cart_item_variant();

alter table public.carts enable row level security;
alter table public.cart_items enable row level security;

drop policy if exists "carts_select_own" on public.carts;
create policy "carts_select_own" on public.carts
for select to authenticated using (auth.uid() = user_id);

drop policy if exists "carts_insert_own" on public.carts;
create policy "carts_insert_own" on public.carts
for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "carts_update_own" on public.carts;
create policy "carts_update_own" on public.carts
for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "carts_delete_own" on public.carts;
create policy "carts_delete_own" on public.carts
for delete to authenticated using (auth.uid() = user_id);

drop policy if exists "cart_items_select_own" on public.cart_items;
create policy "cart_items_select_own" on public.cart_items
for select to authenticated
using (exists (select 1 from public.carts c where c.id = cart_items.cart_id and c.user_id = auth.uid()));

drop policy if exists "cart_items_insert_own" on public.cart_items;
create policy "cart_items_insert_own" on public.cart_items
for insert to authenticated
with check (exists (select 1 from public.carts c where c.id = cart_items.cart_id and c.user_id = auth.uid()));

drop policy if exists "cart_items_update_own" on public.cart_items;
create policy "cart_items_update_own" on public.cart_items
for update to authenticated
using (exists (select 1 from public.carts c where c.id = cart_items.cart_id and c.user_id = auth.uid()))
with check (exists (select 1 from public.carts c where c.id = cart_items.cart_id and c.user_id = auth.uid()));

drop policy if exists "cart_items_delete_own" on public.cart_items;
create policy "cart_items_delete_own" on public.cart_items
for delete to authenticated
using (exists (select 1 from public.carts c where c.id = cart_items.cart_id and c.user_id = auth.uid()));

revoke all on public.carts, public.cart_items from anon;
grant select, insert, update, delete on public.carts, public.cart_items to authenticated;


-- Defense in depth: customers may edit profile fields but cannot change
-- ownership or system authorization fields through the browser.
create or replace function public.prevent_untrusted_profile_system_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    if new.id is distinct from old.id
       or new.user_id is distinct from old.user_id
       or new.role is distinct from old.role
       or new.created_at is distinct from old.created_at then
      raise exception 'System profile fields cannot be changed by customer';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_prevent_untrusted_system_change on public.profiles;
create trigger profiles_prevent_untrusted_system_change
before update on public.profiles
for each row execute function public.prevent_untrusted_profile_system_change();
