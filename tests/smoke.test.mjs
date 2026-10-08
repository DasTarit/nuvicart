import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Phase 1 storefront architecture remains present", () => {
  const required = [
    "app/(storefront)/page.tsx",
    "app/(storefront)/shop/page.tsx",
    "app/(storefront)/search/page.tsx",
    "app/(storefront)/category/[slug]/page.tsx",
    "app/(storefront)/product/[slug]/page.tsx",
    "app/(storefront)/cart/page.tsx",
    "app/(auth)/login/page.tsx",
    "app/(auth)/register/page.tsx",
    "app/(account)/account/page.tsx",
    "features/catalog/service.ts",
    "features/catalog/repository.ts",
    "features/catalog/demo-repository.ts",
    "features/catalog/supabase-repository.ts",
    "features/cart/store.tsx",
    "features/wishlist/store.tsx",
    "supabase/migrations/202610070003_catalog_foundation.sql",
    "supabase/migrations/202610070004_production_catalog.sql",
  ];
  for (const file of required) assert.equal(fs.existsSync(path.join(root, file)), true, file);
});

test("Phase 0 security primitives remain present", () => {
  const migration = read("supabase/migrations/202610070002_harden_profile_role_updates.sql");
  assert.match(migration, /role changes/i);
  assert.match(read("lib/supabase/admin.ts"), /SERVICE_ROLE/);
});

test("Phase 2 production catalog migration contains the required data foundation", () => {
  const migration = read("supabase/migrations/202610070004_production_catalog.sql");
  for (const table of ["product_images", "product_variants", "inventory"]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`, "i"), table);
  }
  for (const table of ["categories", "brands", "products"]) {
    assert.match(migration, new RegExp(`alter table public\\.${table}`, "i"), table);
  }
  for (const token of ["status", "compare_at_price", "is_featured", "sku", "sort_order", "updated_at"]) {
    assert.match(migration, new RegExp(token, "i"), token);
  }
  assert.match(migration, /stock_quantity\s+integer/i);
  assert.match(migration, /reserved_quantity\s+integer/i);
  assert.match(migration, /reserved_quantity <= stock_quantity/i);
  assert.match(migration, /get_product_availability/i);
});

test("Phase 2 RLS keeps public reads narrow and catalog writes out of client roles", () => {
  const migration = read("supabase/migrations/202610070004_production_catalog.sql");
  assert.match(migration, /public_read_active_brands/i);
  assert.match(migration, /public_read_active_products/i);
  assert.match(migration, /public_read_active_product_images/i);
  assert.match(migration, /public_read_active_product_variants/i);
  assert.match(migration, /revoke insert, update, delete on public\.products from anon, authenticated/i);
  assert.match(migration, /revoke all on public\.inventory from anon, authenticated/i);
});

test("Catalog service is the repository boundary and keeps the demo repository available", () => {
  const service = read("features/catalog/service.ts");
  assert.match(service, /hasSupabasePublicConfig/);
  assert.match(service, /supabaseRepository/);
  assert.match(service, /demoRepository/);
  assert.match(read("features/catalog/repository.ts"), /CatalogRepository/);
});

test("Client Components do not import privileged catalog repositories or Supabase clients", () => {
  const clientFiles = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) {
        const source = fs.readFileSync(full, "utf8");
        if (/["']use client["']/.test(source)) clientFiles.push({ full, source });
      }
    }
  };
  walk(path.join(root, "app"));
  walk(path.join(root, "components"));
  walk(path.join(root, "features"));
  for (const { full, source } of clientFiles) {
    assert.doesNotMatch(source, /supabase-repository|features\/catalog\/service|lib\/supabase\/admin|createAdminClient/);
  }
});

test("Seed data covers production catalog entities without random values", () => {
  const seed = read("supabase/seed.sql");
  for (const token of ["product_images", "product_variants", "inventory", "stock_quantity", "NUV-AUR-NOVA-BLK"]) {
    assert.match(seed, new RegExp(token, "i"), token);
  }
  assert.doesNotMatch(seed, /random\s*\(/i);
});


test("ProductCard has one guarded add-to-cart handler for non-variant products", () => {
  const source = read("components/storefront/product-card.tsx");
  const addMatches = source.match(/add\(product\)/g) ?? [];
  assert.equal(addMatches.length, 1);
  assert.match(source, /if \(product\.stock > 0\) \{ add\(product\)/);
  assert.match(source, /product\.requiresVariantSelection \?/);
  assert.match(source, /aria-label="Select options"/);
});

test("Production search covers name, descriptions, tags, brand and category", () => {
  const repository = read("features/catalog/supabase-repository.ts");
  const migration = read("supabase/migrations/202610070004_production_catalog.sql");
  assert.match(repository, /search_catalog_product_ids/);
  for (const token of ["p\\.name", "short_description", "description", "tags", "b\\.name", "c\\.name"]) {
    assert.match(migration, new RegExp(token, "i"), token);
  }
  assert.match(migration, /ilike/i);
  assert.doesNotMatch(repository, /`[^`]*\$\{.*query/i);
});

test("Catalog domain exposes rich product detail without removing the storefront DTO", () => {
  const repository = read("features/catalog/repository.ts");
  const service = read("features/catalog/service.ts");
  const supabase = read("features/catalog/supabase-repository.ts");
  const demo = read("features/catalog/demo-repository.ts");
  assert.match(repository, /getCatalogProduct\(slug: string\)/);
  assert.match(service, /getCatalogProduct/);
  assert.match(supabase, /async getCatalogProduct/);
  assert.match(demo, /async getCatalogProduct/);
  for (const field of ["variants", "images", "availability", "category", "brand"]) {
    assert.match(supabase, new RegExp(field));
  }
  assert.match(service, /getProduct\(slug: string\)/);
});

test("Inventory remains protected and availability is the only public inventory projection", () => {
  const migration = read("supabase/migrations/202610070004_production_catalog.sql");
  assert.match(migration, /alter table public\.inventory enable row level security/i);
  assert.match(migration, /revoke all on public\.inventory from anon, authenticated/i);
  assert.match(migration, /get_product_availability/);
  assert.match(migration, /greatest\(i\.stock_quantity - i\.reserved_quantity, 0\)/i);
  assert.match(migration, /product_variants v on v\.id = i\.variant_id/i);
  assert.match(migration, /v\.is_active = true/i);
  assert.match(migration, /p\.is_active = true/i);
  assert.match(migration, /p\.status = 'active'/i);
  assert.doesNotMatch(read("features/catalog/supabase-repository.ts"), /reserved_quantity/);
});

test("Production price authority excludes legacy original_price from repository reads", () => {
  const repository = read("features/catalog/supabase-repository.ts");
  const migration = read("supabase/migrations/202610070004_production_catalog.sql");
  assert.match(repository, /compare_at_price/);
  assert.match(repository, /price_override/);
  assert.doesNotMatch(repository, /original_price/);
  assert.match(migration, /original_price.*migration compatibility|original_price.*remain/i);
});

test("Seed inventory totals match legacy product stock for variant-backed products", () => {
  const seed = read("supabase/seed.sql");
  assert.match(seed, /'nova-pro-headphones'.*18|NUV-AUR-NOVA-BLK.*10/s);
  assert.match(seed, /NUV-AUR-NOVA-BLK.*10/s);
  assert.match(seed, /NUV-AUR-NOVA-WHT.*8/s);
  assert.match(seed, /'velocity-runner'.*28/s);
  assert.match(seed, /NUV-NOR-VEL-8.*10/s);
  assert.match(seed, /NUV-NOR-VEL-9.*9/s);
  assert.match(seed, /NUV-NOR-VEL-10.*9/s);
  assert.match(seed, /'flux-mechanical-keyboard'.*15/s);
  assert.match(seed, /NUV-KEY-FLX-BLK.*8/s);
  assert.match(seed, /NUV-KEY-FLX-WHT.*7/s);
  assert.doesNotMatch(seed, /random\s*\(/i);
});


test("Existing production shop filters remain wired after search changes", () => {
  const repository = read("features/catalog/supabase-repository.ts");
  const query = read("features/catalog/demo-repository.ts");
  for (const token of ["category", "brand", "minPrice", "maxPrice", "minRating", "inStock", "minDiscount", "sort"]) {
    assert.match(query, new RegExp(token));
  }
  for (const token of ['query.category', 'query.brand', 'input.minPrice', 'input.maxPrice', 'input.minRating', 'input.inStock', 'input.minDiscount', 'input.sort']) {
    assert.match(repository, new RegExp(token.replace(/[.]/g, "\\.")));
  }
});

test("No duplicate production tables or Phase 2 debug artifacts exist", () => {
  const migration = read("supabase/migrations/202610070004_production_catalog.sql");
  const productionDdl = migration.replace(/--[^\n]*/g, "");
  const duplicateNames = ["products", "categories", "inventory"].map((name) => `${name}_${["v", "2"].join("")}`);
  assert.doesNotMatch(
    productionDdl,
    new RegExp(`\\b(create\\s+table(?:\\s+if\\s+not\\s+exists)?\\s+public\\.(${duplicateNames.join("|")}))\\b`, "i"),
  );
  for (const file of [
    "components/storefront/product-card.tsx",
    "features/catalog/supabase-repository.ts",
    "features/catalog/service.ts",
  ]) {
    const forbiddenMarkers = [["TO", "DO"], ["FIX", "ME"]].map((parts) => parts.join(""));
    assert.doesNotMatch(read(file), new RegExp(`\\b(${forbiddenMarkers.join("|")}|console\\.log)\\b`));
  }
});


test("Phase 3 customer persistence migration exists with ownership and constraints", () => {
  const migration = read("supabase/migrations/202610070005_customer_persistence.sql");
  assert.match(migration, /create table if not exists public\.customer_addresses/i);
  assert.match(migration, /create table if not exists public\.carts/i);
  assert.match(migration, /create table if not exists public\.cart_items/i);
  assert.match(migration, /auth\.uid\(\) = user_id/i);
  assert.match(migration, /quantity >= 1/i);
  assert.match(migration, /one_default/i);
  assert.match(migration, /set_default_customer_address/i);
  assert.match(migration, /prevent_untrusted_profile_system_change/i);
});

test("Phase 3 customer repository derives identity server-side", () => {
  const repo = read("features/customer/supabase-repository.ts");
  assert.match(repo, /supabase\.auth\.getUser\(\)/);
  assert.match(repo, /UNAUTHENTICATED/);
  assert.doesNotMatch(repo, /process\.env\..*SERVICE_ROLE/i);
});

test("Phase 3 customer API does not accept user ownership identifiers", () => {
  const api = [
    "app/api/customer/state/route.ts",
    "app/api/customer/sync/route.ts",
    "app/api/customer/profile/route.ts",
    "app/api/customer/addresses/route.ts",
    "app/api/customer/addresses/[id]/route.ts",
    "app/api/customer/wishlist/route.ts",
    "app/api/customer/cart/route.ts",
  ].map(read).join("\n");
  assert.doesNotMatch(api, /user_id\s*:/i);
  assert.doesNotMatch(api, /userId\s*:\s*(body|b)\./i);
});

test("Phase 3 guest stores retain local persistence while shared sync owns account synchronization", () => {
  const wishlist = read("features/wishlist/store.tsx");
  const cart = read("features/cart/store.tsx");
  const sync = read("components/providers/customer-sync-provider.tsx");
  for (const source of [wishlist, cart]) assert.match(source, /localStorage/);
  assert.match(sync, /\/api\/customer\/sync/);
  assert.match(sync, /\/api\/customer\/state/);
  assert.match(wishlist, /nuvicart-auth-user/);
  assert.match(cart, /nuvicart-auth-user/);
});

test("Phase 3 account UI contains profile, addresses, wishlist, and orders routes", () => {
  for (const file of [
    "app/(account)/account/page.tsx",
    "app/(account)/account/profile/page.tsx",
    "app/(account)/account/addresses/page.tsx",
    "app/(account)/account/wishlist/page.tsx",
    "app/(account)/account/orders/page.tsx",
  ]) assert.equal(fs.existsSync(path.join(root, file)), true, file);
  assert.match(read("components/storefront/account-nav.tsx"), /Addresses/);
});

test("Phase 3 preserves role hardening and avoids duplicate persistence tables", () => {
  assert.match(read("supabase/migrations/202610070002_harden_profile_role_updates.sql"), /prevent_untrusted_role_change/);
  const migration = read("supabase/migrations/202610070005_customer_persistence.sql");
  for (const duplicate of ["profiles_v2", "wishlist_v2", "cart_v2", "addresses_v2"]) {
    assert.doesNotMatch(migration, new RegExp(duplicate, "i"), duplicate);
  }
});

test("Phase 3 baseline migrations remain free of unrelated shipping/email functionality", () => {
  const migrations = fs.readdirSync(path.join(root, "supabase/migrations"))
    .filter((file) => /^20261007\d+_/.test(file))
    .map((file) => read(`supabase/migrations/${file}`))
    .join("\n");
  assert.doesNotMatch(migrations, /shiprocket|resend/i);
  assert.doesNotMatch(migrations, /razorpay/i);
});

test("Phase 3.1 has exactly one coordinated customer synchronization owner", () => {
  const cart = read("features/cart/store.tsx");
  const wishlist = read("features/wishlist/store.tsx");
  const provider = read("components/providers/customer-sync-provider.tsx");
  assert.doesNotMatch(cart, /\/api\/customer\/sync/);
  assert.doesNotMatch(wishlist, /\/api\/customer\/sync/);
  assert.match(provider, /\/api\/customer\/sync/);
  assert.match(provider, /guestCart/);
  assert.match(provider, /guestWishlist/);
  assert.match(provider, /replaceFromCustomerState/);
});

test("Phase 3.1 synchronization is user-scoped and idempotency-marked", () => {
  const client = read("components/providers/customer-sync-provider.tsx");
  const route = read("app/api/customer/sync/route.ts");
  assert.match(client, /nuvicart-customer-sync-marker/);
  assert.match(client, /\$\{state\.userId\}:\$\{marker\}/);
  assert.match(client, /SHA-256/);
  assert.match(route, /syncToken/);
  assert.match(route, /nuvicart-sync-user/);
  assert.match(route, /nuvicart-sync-token/);
  assert.match(route, /alreadySynchronized/);
  assert.match(route, /supabase\.auth\.getUser/);
});

test("Phase 3.1 synchronization preserves both account and guest state", () => {
  const route = read("app/api/customer/sync/route.ts");
  assert.match(route, /addWishlist\(productId\)/);
  assert.match(route, /mergeCart\(cartItems\)/);
  assert.match(route, /getWishlist\(\), getCart\(\)/);
  assert.doesNotMatch(route, /delete.*wishlist|clearCart\(\)/i);
});

test("Phase 3.1 logout clears private local state without copying it to guests", () => {
  const provider = read("components/providers/customer-sync-provider.tsx");
  assert.match(provider, /SIGNED_OUT/);
  assert.match(provider, /cart\.clearForLogout\(\)/);
  assert.match(provider, /wishlist\.clearForLogout\(\)/);
  assert.match(provider, /localStorage/);
  assert.doesNotMatch(provider, /localStorage\.setItem\([^)]*cart[^)]*remote|localStorage\.setItem\([^)]*wishlist[^)]*merged/i);
});

test("Phase 3.1 cart trigger requires variants when active variants exist", () => {
  const migration = read("supabase/migrations/202610070005_customer_persistence.sql");
  assert.match(migration, /new\.variant_id is null and exists/i);
  assert.match(migration, /v\.product_id = new\.product_id/i);
  assert.match(migration, /v\.is_active = true/i);
  assert.match(migration, /Cart item variant is required for products with active variants/i);
  assert.match(migration, /Cart item variant is invalid or inactive/i);
});

test("Phase 3.1 profile email is read-only and sourced from Auth", () => {
  const types = read("features/customer/types.ts");
  const repo = read("features/customer/supabase-repository.ts");
  const route = read("app/api/customer/profile/route.ts");
  const page = read("app/(account)/account/profile/page.tsx");
  assert.match(types, /email: string/);
  assert.match(repo, /email: user\.email/);
  assert.doesNotMatch(route, /b\.email/);
  assert.match(page, /profile\?\.email/);
  assert.match(page, /readOnly disabled/);
});

test("Phase 3.1 does not retain competing synchronization locks", () => {
  for (const file of ["features/cart/store.tsx", "features/wishlist/store.tsx"]) {
    assert.doesNotMatch(read(file), /SYNC_LOCK|nuvicart-customer-sync(?!-marker)/);
  }
});


test("Phase 3.2 exposes a minimal variant-selection requirement in the storefront DTO", () => {
  const types = read("features/catalog/types.ts");
  const production = read("features/catalog/supabase-repository.ts");
  const demo = read("features/catalog/demo-repository.ts");
  assert.match(types, /requiresVariantSelection: boolean/);
  assert.match(production, /requiresVariantSelection: variants\.length > 0/);
  assert.match(production, /requiresVariantSelection: product\.variants\.length > 0/);
  assert.match(demo, /requiresVariantSelection: false/);
});

test("Phase 3.2 CartProvider rejects unqualified variant-backed products", () => {
  const cart = read("features/cart/store.tsx");
  assert.match(cart, /product\.requiresVariantSelection/);
  assert.match(cart, /stock <= 0 \|\| product\.requiresVariantSelection/);
  assert.match(cart, /if \(product\.requiresVariantSelection\) return \[\]/);
});

test("Phase 3.2 ProductCard directs variant-backed products to product detail", () => {
  const card = read("components/storefront/product-card.tsx");
  assert.match(card, /product\.requiresVariantSelection/);
  assert.match(card, /Select options/);
  assert.match(card, /href=\{`\/product\/\$\{product\.slug\}`\}/);
  assert.match(card, /product\.requiresVariantSelection \? \(\s*<Link[\s\S]*?aria-label="Select options"/);
});

test("Phase 3.2 ProductPageClient cannot submit an unqualified variant", () => {
  const page = read("components/storefront/product-page-client.tsx");
  assert.match(page, /const requiresVariant = product\.requiresVariantSelection/);
  assert.match(page, /unavailable \|\| requiresVariant/);
  assert.match(page, /requiresVariant \? "Select options"/);
  assert.match(page, /Select a product option before adding/);
});

test("Phase 3.2 guest sync skips variant-backed products without a variant", () => {
  const sync = read("components/providers/customer-sync-provider.tsx");
  assert.match(sync, /item\.product\.requiresVariantSelection === true/);
  assert.match(sync, /variantId: null/);
  assert.match(sync, /return \[\]/);
});

test("Phase 3.2 non-variant demo products remain addable", () => {
  const data = read("features/catalog/data.ts");
  const cart = read("features/cart/store.tsx");
  assert.match(data, /requiresVariantSelection:false/);
  assert.match(cart, /if \(product\.stock <= 0 \|\| product\.requiresVariantSelection\) return/);
});

test("Phase 3.2 database variant integrity trigger remains authoritative", () => {
  const migration = read("supabase/migrations/202610070005_customer_persistence.sql");
  assert.match(migration, /new\.variant_id is null and exists/i);
  assert.match(migration, /Cart item variant is required for products with active variants/i);
  assert.match(migration, /v\.product_id = new\.product_id/i);
  assert.match(migration, /v\.is_active = true/i);
});

test("Phase 3.2 server cart paths enforce the same variant requirement", () => {
  const repo = read("features/customer/supabase-repository.ts");
  assert.match(repo, /productsRequiringVariant/);
  assert.match(repo, /!item\.variantId && productsRequiringVariant\.has\(resolvedId\)/);
  assert.match(repo, /Variant selection required/);
  assert.match(repo, /variant\.product_id|eq\("product_id", resolvedProductId\)/);
});

test("Phase 4A order schema creates orders and order items without duplicate tables", () => {
  const migration = read("supabase/migrations/202610070006_order_engine.sql");
  assert.match(migration, /create table if not exists public\.orders/i);
  assert.match(migration, /create table if not exists public\.order_items/i);
  assert.doesNotMatch(migration, /orders_v2|order_items_v2|inventory_v2/i);
  for (const field of ["user_id", "order_number", "status", "payment_status", "currency", "subtotal", "discount_total", "shipping_total", "tax_total", "grand_total", "billing_address_snapshot", "shipping_address_snapshot", "idempotency_key"]) {
    assert.match(migration, new RegExp(`\\b${field}\\b`, "i"), field);
  }
  assert.match(migration, /currency\s+text\s+not null\s+default 'INR'/i);
  assert.match(migration, /numeric\(12,2\)/i);
});

test("Phase 4A order state machine separates order and payment status", () => {
  const migration = read("supabase/migrations/202610070006_order_engine.sql");
  assert.match(migration, /pending_payment.*paid.*processing.*shipped.*delivered.*cancelled.*refunded/s);
  assert.match(migration, /payment_status.*pending.*paid.*failed.*refunded/s);
  assert.match(migration, /validate_order_state_transition/);
  assert.match(migration, /Invalid order status transition/);
  assert.match(migration, /Invalid payment status transition/);
});

test("Phase 4A order item snapshots and address snapshots are persisted", () => {
  const migration = read("supabase/migrations/202610070006_order_engine.sql");
  for (const field of ["product_name", "sku", "variant_name", "variant_sku", "unit_price", "quantity", "line_subtotal"]) {
    assert.match(migration, new RegExp(`\\b${field}\\b`, "i"), field);
  }
  for (const field of ["full_name", "phone", "address_line_1", "address_line_2", "landmark", "city", "state", "postal_code", "country"]) {
    assert.match(migration, new RegExp(`'${field}'`, "i"), field);
  }
  assert.match(migration, /on delete set null/i);
});

test("Phase 4A checkout is server-authoritative and accepts only address plus idempotency key", () => {
  const route = read("app/api/orders/checkout/route.ts");
  const rpc = read("supabase/migrations/202610070006_order_engine.sql");
  assert.match(route, /addressId/);
  assert.match(route, /idempotencyKey/);
  assert.doesNotMatch(route, /grandTotal|subtotal|shippingTotal|taxTotal|price|inventory|userId/);
  assert.match(rpc, /auth\.uid\(\)/);
  assert.match(rpc, /p_address_id/);
  assert.match(rpc, /p_idempotency_key/);
  assert.match(rpc, /v_product\.price/);
  assert.match(rpc, /v_variant\.price_override/);
  assert.match(rpc, /stock_quantity - i\.reserved_quantity/);
  assert.match(rpc, /v_address\.user_id = v_user_id|user_id = v_user_id/);
});

test("Phase 4A checkout uses atomic database order creation and cart clearing", () => {
  const migration = read("supabase/migrations/202610070006_order_engine.sql");
  assert.match(migration, /security definer/i);
  assert.match(migration, /for update/);
  assert.match(migration, /insert into public\.orders/i);
  assert.match(migration, /insert into public\.order_items/i);
  assert.match(migration, /delete from public\.cart_items/i);
  assert.match(migration, /returns jsonb/i);
});

test("Phase 4A idempotency is database-enforced and retries return the existing order", () => {
  const migration = read("supabase/migrations/202610070006_order_engine.sql");
  assert.match(migration, /orders_user_idempotency_unique_idx/);
  assert.match(migration, /unique index.*orders\(user_id, idempotency_key\)/is);
  assert.match(migration, /where user_id = v_user_id and idempotency_key = p_idempotency_key/i);
  assert.match(migration, /'existing', true/i);
  assert.match(migration, /when unique_violation then/i);
});

test("Phase 4A inventory is validated but not decremented during unpaid order creation", () => {
  const migration = read("supabase/migrations/202610070006_order_engine.sql");
  assert.match(migration, /INSUFFICIENT_STOCK/);
  assert.match(migration, /stock_quantity - i\.reserved_quantity/);
  assert.doesNotMatch(migration, /update public\.inventory/i);
  assert.doesNotMatch(migration, /delete from public\.inventory/i);
});

test("Phase 4A order RLS prevents direct customer mutation and scopes reads", () => {
  const migration = read("supabase/migrations/202610070006_order_engine.sql");
  assert.match(migration, /auth\.uid\(\) = user_id/i);
  assert.match(migration, /o\.id = order_items\.order_id[\s\S]*o\.user_id = auth\.uid\(\)/i);
  assert.match(migration, /revoke insert, update, delete on public\.orders, public\.order_items from anon, authenticated/i);
  assert.match(migration, /grant select on public\.orders, public\.order_items to authenticated/i);
  assert.match(migration, /grant execute on function public\.create_order_from_cart\(uuid, text\) to authenticated/i);
});

test("Phase 4B checkout UI uses server totals and routes payment through server verification", () => {
  const page = read("app/(storefront)/checkout/page.tsx");
  const review = read("components/storefront/checkout-review.tsx");
  assert.match(page, /getCheckoutPreview/);
  assert.match(review, /preview\.grandTotal/);
  assert.match(review, /preview\.subtotal/);
  assert.match(review, /addressId/);
  assert.match(review, /api\/orders\/checkout/);
  assert.match(review, /api\/payments\/order/);
  assert.match(review, /api\/payments\/verify/);
  assert.match(review, /Razorpay/);
});

test("Phase 4A order history is read-only and customer scoped", () => {
  assert.equal(fs.existsSync(path.join(root, "app/(account)/account/orders/page.tsx")), true);
  assert.equal(fs.existsSync(path.join(root, "app/(account)/account/orders/[orderNumber]/page.tsx")), true);
  const page = read("app/(account)/account/orders/page.tsx");
  const detail = read("app/(account)/account/orders/[orderNumber]/page.tsx");
  const repo = read("features/orders/supabase-repository.ts");
  assert.match(page, /order\.orderNumber/);
  assert.match(detail, /order\.items/);
  assert.match(detail, /shippingAddressSnapshot/);
  assert.doesNotMatch(page + detail, /update|cancel|refund/i);
  assert.match(repo, /from\("orders"\)/);
});

test("Phase 4A order architecture keeps checkout behind the order service boundary", () => {
  assert.equal(fs.existsSync(path.join(root, "features/orders/service.ts")), true);
  assert.equal(fs.existsSync(path.join(root, "features/orders/repository.ts")), true);
  assert.equal(fs.existsSync(path.join(root, "features/orders/supabase-repository.ts")), true);
  const route = read("app/api/orders/checkout/route.ts");
  const service = read("features/orders/service.ts");
  assert.match(route, /createOrderFromCart/);
  assert.match(service, /orderRepository/);
});


test("Phase 4A.1 migration upgrades existing order tables without duplicate v2 objects", () => {
  const migration = read("supabase/migrations/202610070007_order_engine_hardening.sql");
  assert.doesNotMatch(migration, /create table.*orders|create table.*order_items|orders_v2|order_items_v2/i);
  assert.match(migration, /create or replace function public\.create_order_from_cart\(/i);
  assert.match(migration, /orders_discount_not_exceed_subtotal_check/i);
});

test("Phase 4A.1 persists both address snapshots from the same authenticated saved address", () => {
  const migration = read("supabase/migrations/202610070007_order_engine_hardening.sql");
  assert.match(migration, /where id = p_address_id and user_id = v_user_id/i);
  assert.match(migration, /v_address_snapshot\s*:=\s*jsonb_build_object/i);
  assert.match(migration, /billing_address_snapshot, shipping_address_snapshot, idempotency_key[\s\S]*v_address_snapshot, v_address_snapshot, p_idempotency_key/i);
  assert.match(migration, /billing_address_snapshot.*same authenticated saved customer address/i);
});

test("Phase 4A.1 strengthens database money invariants", () => {
  const migration = read("supabase/migrations/202610070007_order_engine_hardening.sql");
  assert.match(migration, /orders_discount_not_exceed_subtotal_check/i);
  assert.match(read("supabase/migrations/202610070006_order_engine.sql"), /subtotal >= 0 and discount_total >= 0 and shipping_total >= 0 and tax_total >= 0 and grand_total >= 0/i);
  assert.match(migration, /v_discount_total\s*:=\s*0/i);
  assert.match(migration, /v_shipping_total\s*:=\s*0/i);
  assert.match(migration, /v_tax_total\s*:=\s*0/i);
  assert.match(migration, /v_grand_total\s*:=\s*\(v_subtotal - v_discount_total \+ v_shipping_total \+ v_tax_total\)/i);
});

test("Phase 4A.1 rejects impossible order/payment combinations while preserving transition guards", () => {
  const migration = read("supabase/migrations/202610070007_order_engine_hardening.sql");
  assert.match(migration, /validate_order_state_transition/);
  assert.match(migration, /Invalid order status transition/);
  assert.match(migration, /Invalid payment status transition/);
  assert.match(migration, /pending_payment.*payment_status = 'paid'/is);
  assert.match(migration, /status in \('paid', 'processing', 'shipped', 'delivered'\).*payment_status <> 'paid'/is);
  assert.match(migration, /status = 'refunded'.*payment_status <> 'refunded'/is);
  assert.match(migration, /payment_status = 'refunded'.*status <> 'refunded'/is);
  assert.match(migration, /status = 'paid'.*payment_status = 'failed'/is);
  assert.match(migration, /orders_state_payment_consistency_check/i);
  assert.match(migration, /before insert or update on public\.orders/i);
});

test("Phase 4A.1 keeps idempotency user-scoped and client input limited", () => {
  const migration = read("supabase/migrations/202610070007_order_engine_hardening.sql");
  const route = read("app/api/orders/checkout/route.ts");
  const base = read("supabase/migrations/202610070006_order_engine.sql");
  assert.match(base, /orders_user_idempotency_unique_idx/i);
  assert.match(migration, /where user_id = v_user_id and idempotency_key = p_idempotency_key/i);
  assert.match(migration, /auth\.uid\(\)/i);
  assert.match(route, /body\.addressId/);
  assert.match(route, /body\.idempotencyKey/);
  assert.doesNotMatch(route, /body\.(userId|subtotal|grandTotal|price|inventory|paymentStatus|orderStatus|shippingAmount|taxAmount|discountAmount)/i);
});

test("Phase 4A.1 final order creation revalidates price, totals, address, and inventory instead of trusting preview", () => {
  const migration = read("supabase/migrations/202610070007_order_engine_hardening.sql");
  assert.match(migration, /Final authoritative product reload/i);
  assert.match(migration, /Final authoritative variant reload/i);
  assert.match(migration, /Final authoritative price and availability reload/i);
  assert.match(migration, /v_product\.price/i);
  assert.match(migration, /v_variant\.price_override/i);
  assert.match(migration, /stock_quantity - i\.reserved_quantity/i);
  assert.match(migration, /v_line_subtotal := \(v_unit_price \* v_cart_item\.quantity\)/i);
  assert.match(migration, /v_subtotal := \(v_subtotal \+ v_line_subtotal\)/i);
  assert.match(migration, /v_grand_total := \(v_subtotal - v_discount_total \+ v_shipping_total \+ v_tax_total\)/i);
});

test("Phase 4A.1 preserves atomic cart locking and no inventory decrement", () => {
  const migration = read("supabase/migrations/202610070007_order_engine_hardening.sql");
  assert.match(migration, /from public\.carts[\s\S]*for update/i);
  assert.match(migration, /from public\.cart_items[\s\S]*for update/i);
  assert.match(migration, /insert into public\.orders/i);
  assert.match(migration, /insert into public\.order_items/i);
  assert.match(migration, /delete from public\.cart_items/i);
  assert.doesNotMatch(migration, /update public\.inventory/i);
  assert.doesNotMatch(migration, /delete from public\.inventory/i);
  assert.match(migration, /exception[\s\S]*when unique_violation/i);
});

test("Phase 4A.1 failed checkout paths raise before cart clearing, preserving transaction rollback semantics", () => {
  const migration = read("supabase/migrations/202610070007_order_engine_hardening.sql");
  const clearIndex = migration.indexOf("delete from public.cart_items where cart_id = v_cart_id");
  assert.ok(clearIndex > 0);
  for (const errorToken of ["INVALID_ADDRESS", "EMPTY_CART", "INVALID_QUANTITY", "UNAVAILABLE_PRODUCT", "UNAVAILABLE_VARIANT", "VARIANT_REQUIRED", "INSUFFICIENT_STOCK"]) {
    const errorIndex = migration.indexOf(`raise exception '${errorToken}'`);
    assert.ok(errorIndex >= 0 && errorIndex < clearIndex, errorToken);
  }
});

test("Phase 4A.1 customer order and order-item RLS remains owner-scoped with direct writes revoked", () => {
  const migration = read("supabase/migrations/202610070006_order_engine.sql");
  assert.match(migration, /auth\.uid\(\) = user_id/i);
  assert.match(migration, /o\.id = order_items\.order_id[\s\S]*o\.user_id = auth\.uid\(\)/i);
  assert.match(migration, /revoke insert, update, delete on public\.orders, public\.order_items from anon, authenticated/i);
  assert.match(migration, /grant select on public\.orders, public\.order_items to authenticated/i);
});

test("Phase 4A.1 preserves historical item snapshots and nullable catalog references", () => {
  const migration = read("supabase/migrations/202610070007_order_engine_hardening.sql");
  const base = read("supabase/migrations/202610070006_order_engine.sql");
  for (const field of ["product_name", "sku", "variant_name", "variant_sku", "unit_price", "quantity", "line_subtotal"]) {
    assert.match(base, new RegExp(`\\b${field}\\b`, "i"), field);
  }
  assert.match(base, /product_id uuid references public\.products\(id\) on delete set null/i);
  assert.match(base, /variant_id uuid references public\.product_variants\(id\) on delete set null/i);
  assert.match(migration, /Re-read snapshots from the current authoritative catalog/i);
});



test("Phase 4A.2 adds a versioned RPC replacement without duplicating order schema", () => {
  const migration = read("supabase/migrations/202610070008_order_transaction_consistency.sql");
  assert.equal(fs.existsSync(path.join(root, "supabase/migrations/202610070008_order_transaction_consistency.sql")), true);
  assert.doesNotMatch(migration, /create table.*orders|create table.*order_items|orders_v3|order_items_v3/i);
  assert.match(migration, /create or replace function public\.create_order_from_cart\([\s\S]*?p_address_id uuid,[\s\S]*?p_idempotency_key text/i);
  assert.match(migration, /revoke all on function public\.create_order_from_cart\(uuid, text\)/i);
  assert.match(migration, /grant execute on function public\.create_order_from_cart\(uuid, text\) to authenticated/i);
});

test("Phase 4A.2 captures each authoritative line exactly once", () => {
  const migration = read("supabase/migrations/202610070008_order_transaction_consistency.sql");
  assert.match(migration, /v_line_snapshots jsonb := '\[\]'::jsonb/i);
  assert.match(migration, /product_id.*variant_id.*product_name.*sku.*variant_name.*variant_sku.*unit_price.*quantity.*line_subtotal/is);
  assert.match(migration, /v_line_snapshots := v_line_snapshots \|\| jsonb_build_array\(jsonb_build_object/i);
  assert.match(migration, /unit_price', v_unit_price/i);
  assert.match(migration, /line_subtotal', v_line_subtotal/i);
});

test("Phase 4A.2 uses captured price for subtotal, grand total, and order items", () => {
  const migration = read("supabase/migrations/202610070008_order_transaction_consistency.sql");
  assert.match(migration, /v_line_subtotal := \(v_unit_price \* v_cart_item\.quantity\)/i);
  assert.match(migration, /v_subtotal := \(v_subtotal \+ v_line_subtotal\)/i);
  assert.match(migration, /v_grand_total := \(v_subtotal - v_discount_total \+ v_shipping_total \+ v_tax_total\)/i);
  assert.match(migration, /from jsonb_to_recordset\(v_line_snapshots\)/i);
  assert.match(migration, /line\.unit_price.*line\.quantity.*line\.line_subtotal/is);
});

test("Phase 4A.2 does not perform a second catalog-price read for order_items", () => {
  const migration = read("supabase/migrations/202610070008_order_transaction_consistency.sql");
  const itemInsert = migration.indexOf("Create historical item copies exclusively from the captured authoritative snapshots");
  assert.ok(itemInsert > 0);
  const afterCapture = migration.slice(itemInsert);
  assert.doesNotMatch(afterCapture, /select \* into v_product|select \* into v_variant|v_product\.price|v_variant\.price_override/i);
  assert.match(afterCapture, /jsonb_to_recordset\(v_line_snapshots\)/i);
});

test("Phase 4A.2 protects preview-to-final consistency by making preview values non-authoritative", () => {
  const migration = read("supabase/migrations/202610070008_order_transaction_consistency.sql");
  assert.match(migration, /preview values are never trusted/i);
  assert.match(migration, /captured once for this order attempt/i);
  assert.match(migration, /no later catalog read is used to construct order_items/i);
});

test("Phase 4A.2 captures independent snapshots for multiple cart lines", () => {
  const migration = read("supabase/migrations/202610070008_order_transaction_consistency.sql");
  assert.match(migration, /for v_cart_item in[\s\S]*v_line_snapshots := v_line_snapshots \|\|/i);
  assert.match(migration, /order by ci\.created_at/i);
  assert.match(migration, /jsonb_to_recordset\(v_line_snapshots\)/i);
});

test("Phase 4A.2 captures variant price overrides once and preserves non-variant prices", () => {
  const migration = read("supabase/migrations/202610070008_order_transaction_consistency.sql");
  assert.match(migration, /coalesce\(v_variant\.price_override, v_product\.price\)/i);
  assert.match(migration, /v_unit_price := v_product\.price/i);
  assert.match(migration, /'variant_id', v_variant\.id/i);
});

test("Phase 4A.2 retains atomic rollback ordering when item insertion fails", () => {
  const migration = read("supabase/migrations/202610070008_order_transaction_consistency.sql");
  const orderIndex = migration.indexOf("insert into public.orders");
  const itemIndex = migration.indexOf("insert into public.order_items");
  const clearIndex = migration.indexOf("delete from public.cart_items where cart_id = v_cart_id");
  assert.ok(orderIndex > 0 && itemIndex > orderIndex && clearIndex > itemIndex);
  assert.match(migration, /exception[\s\S]*when unique_violation/i);
  for (const errorToken of ["INVALID_ADDRESS", "EMPTY_CART", "INVALID_QUANTITY", "UNAVAILABLE_PRODUCT", "UNAVAILABLE_VARIANT", "VARIANT_REQUIRED", "INSUFFICIENT_STOCK"]) {
    const errorIndex = migration.indexOf(`raise exception '${errorToken}'`);
    assert.ok(errorIndex >= 0 && errorIndex < clearIndex, errorToken);
  }
});

test("Phase 4A.2 preserves user-scoped idempotency concurrency handling", () => {
  const migration = read("supabase/migrations/202610070008_order_transaction_consistency.sql");
  const base = read("supabase/migrations/202610070006_order_engine.sql");
  assert.match(base, /unique index.*orders\(user_id, idempotency_key\)/is);
  assert.match(migration, /where user_id = v_user_id and idempotency_key = p_idempotency_key/i);
  assert.match(migration, /when unique_violation/i);
});

test("Phase 4A.2 preserves server-only checkout inputs and inventory validation semantics", () => {
  const migration = read("supabase/migrations/202610070008_order_transaction_consistency.sql");
  const route = read("app/api/orders/checkout/route.ts");
  assert.match(route, /body\.addressId/);
  assert.match(route, /body\.idempotencyKey/);
  assert.doesNotMatch(route, /body\.(unitPrice|subtotal|grandTotal|productName|sku|quantity|discount|shipping|tax|paymentStatus|orderStatus|userId)/i);
  assert.match(migration, /stock_quantity - i\.reserved_quantity/i);
  assert.doesNotMatch(migration, /update public\.inventory/i);
  assert.doesNotMatch(migration, /delete from public\.inventory/i);
});

test("Phase 4A.2 keeps address snapshots sourced from the authenticated saved address", () => {
  const migration = read("supabase/migrations/202610070008_order_transaction_consistency.sql");
  assert.match(migration, /where id = p_address_id and user_id = v_user_id/i);
  assert.match(migration, /billing_address_snapshot, shipping_address_snapshot, idempotency_key[\s\S]*v_address_snapshot, v_address_snapshot, p_idempotency_key/i);
});

test("Phase 4A.2 does not add catalog row locks or payment/inventory lifecycle behavior", () => {
  const migration = read("supabase/migrations/202610070008_order_transaction_consistency.sql");
  assert.doesNotMatch(migration, /from public\.products[\s\S]*for update/i);
  assert.doesNotMatch(migration, /from public\.product_variants[\s\S]*for update/i);
  assert.doesNotMatch(migration, /from public\.inventory[\s\S]*for update/i);
});

test("Phase 4A migration itself remains payment-free while Phase 4B adds the payment implementation", () => {
  const migration = read("supabase/migrations/202610070008_order_transaction_consistency.sql");
  assert.doesNotMatch(migration, /razorpay|shiprocket|resend|paymentgateway/i);
  assert.doesNotMatch(migration, /webhook(?:s)?\s*handler|verifyPayment/i);
});
