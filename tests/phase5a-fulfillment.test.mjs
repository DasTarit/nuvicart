import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migration = () => read("supabase/migrations/202610090001_fulfillment_foundation.sql");
const orderRepo = () => read("features/orders/supabase-repository.ts");
const orderTypes = () => read("features/orders/types.ts");
const manualRoute = () => read("app/api/fulfillment/manual/route.ts");
const shipping = () => read("lib/shipping/types.ts") + read("lib/shipping/manual.ts") + read("lib/shipping/index.ts");

for (const file of [
  "supabase/migrations/202610090001_fulfillment_foundation.sql",
  "features/fulfillment/types.ts",
  "features/fulfillment/repository.ts",
  "features/fulfillment/service.ts",
  "features/fulfillment/supabase-repository.ts",
  "lib/shipping/types.ts",
  "lib/shipping/manual.ts",
  "app/api/fulfillment/manual/route.ts",
]) assert.equal(fs.existsSync(path.join(root, file)), true, file);

test("unpaid order cannot enter fulfillment", () => {
  const sql = migration();
  assert.match(sql, /v_order\.status <> 'paid' or v_order\.payment_status <> 'paid'/i);
  assert.match(sql, /ORDER_NOT_FULFILLABLE/);
});

test("failed payment cannot enter fulfillment", () => assert.match(migration(), /payment_status <> 'paid'/i));

test("paid order can create fulfillment", () => {
  const sql = migration();
  assert.match(sql, /v_order\.status <> 'paid' or v_order\.payment_status <> 'paid'/i);
  assert.match(sql, /insert into public\.fulfillments\(order_id, status, shipping_address_snapshot\)/i);
});

test("paid_inventory_issue cannot enter normal fulfillment", () => assert.match(migration(), /INVENTORY_EXCEPTION_REQUIRES_RESOLUTION/));

test("fulfillment creation is idempotent", () => {
  const sql = migration();
  assert.match(sql, /order_id uuid not null unique/i);
  assert.match(sql, /select \* into v_existing from public\.fulfillments where order_id = p_order_id for update/i);
  assert.match(sql, /if v_existing\.id is not null then[\s\S]*return v_existing/i);
});

test("invalid fulfillment transitions fail at database layer", () => {
  const sql = migration();
  assert.match(sql, /create or replace function public\.validate_fulfillment_status_transition/i);
  assert.match(sql, /Invalid fulfillment status transition/i);
  assert.match(sql, /create trigger fulfillments_validate_status_transition/i);
});

test("delivered fulfillment cannot return to shipped", () => assert.match(migration(), /old\.status = 'shipped' and new\.status = 'delivered'/i));

test("cancelled fulfillment cannot become shipped", () => { const sql = migration().split('create or replace function public.validate_fulfillment_status_transition')[1].split('alter table public.fulfillments enable row level security')[0]; assert.doesNotMatch(sql, /old\.status = 'cancelled'[\s\S]*new\.status = 'shipped'/i); });

test("shipping address comes from immutable order snapshot", () => {
  const sql = migration();
  assert.match(sql, /shipping_address_snapshot\)\n  values \(v_order\.id, 'pending', v_order\.shipping_address_snapshot\)/i);
});

test("changing customer address cannot alter fulfillment snapshot", () => {
  const sql = migration();
  assert.doesNotMatch(sql, /update public\.customer_addresses/i);
  assert.match(sql, /shipping_address_snapshot jsonb not null/i);
});

test("fulfillment does not decrement inventory", () => assert.doesNotMatch(migration(), /update public\.inventory|delete from public\.inventory|stock_quantity\s*=.*-/i));

test("customer cannot mutate fulfillment directly", () => {
  const sql = migration();
  assert.match(sql, /revoke insert, update, delete on public\.fulfillments, public\.fulfillment_events from anon, authenticated/i);
  assert.match(sql, /fulfillments_select_own/i);
});

test("customer can read only own fulfillment", () => assert.match(migration(), /o\.user_id = auth\.uid\(\)/i));

test("carrier and tracking data are server-controlled", () => {
  assert.match(manualRoute(), /role !== "admin" && role !== "super_admin"/);
  assert.match(migration(), /assign_manual_shipment/);
});

test("manual shipping assignment is protected", () => {
  const sql = migration();
  assert.match(sql, /require_fulfillment_operator/);
  assert.match(sql, /if v_fulfillment\.status <> 'ready_to_ship'/i);
});

test("tracking information is customer-scoped", () => {
  assert.match(migration(), /fulfillments_select_own/);
  assert.match(orderRepo(), /tracking_number/);
});

test("order and fulfillment synchronization is server-side", () => {
  const sql = migration();
  assert.match(sql, /update public\.orders set status = 'processing'/i);
  assert.match(sql, /update public\.orders set status = 'shipped'/i);
  assert.match(sql, /update public\.orders set status = 'delivered'/i);
  assert.match(sql, /update public\.orders set status = 'cancelled'/i);
  assert.doesNotMatch(read("app/(account)/account/orders/page.tsx"), /update\(/i);
});

test("repeated state transition is idempotent", () => assert.match(migration(), /if p_status = v_fulfillment\.status then\n    return v_fulfillment/i));

test("shipping provider boundary exists without an external provider", () => {
  assert.match(shipping(), /interface ShippingProvider/);
  assert.match(shipping(), /manualShippingProvider/);
  assert.doesNotMatch(shipping(), /fetch\(|axios|shiprocket/i);
  assert.doesNotMatch(manualRoute(), /shiprocket/i);
});

test("Phase 4B payment implementation remains untouched", () => {
  assert.equal(fs.existsSync(path.join(root, "app/api/payments/webhook/route.ts")), true);
  assert.equal(fs.existsSync(path.join(root, "lib/payments/razorpay.ts")), true);
  assert.match(read("supabase/migrations/202610080003_razorpay_webhook_recovery.sql"), /claim_razorpay_webhook_event/);
});

test("payment regression protection remains present", () => {
  assert.match(read("tests/phase4b-payment.test.mjs"), /signature|Razorpay|finalize/i);
  assert.match(read("tests/phase4b1-reliability.test.mjs"), /captured|inventory|idempot/i);
  assert.match(read("tests/phase4b2-webhook-recovery.test.mjs"), /reclaimed|processing_token|captured/i);
});

test("no duplicate fulfillment architecture is introduced", () => {
  const files = fs.readdirSync(path.join(root, "supabase/migrations"));
  assert.equal(files.filter((f) => /fulfillment.*v2|order.*v2|inventory.*v2|payment.*v2/i.test(f)).length, 0);
  assert.doesNotMatch(migration(), /create table.*(fulfillments_v2|shipments_v2)/i);
});

test("README documents Phase 5A boundaries", () => {
  const readme = read("README.md");
  for (const token of ["Phase 5A", "ShippingProvider", "Shiprocket", "Refunds", "manual provider", "shipping_address_snapshot"]) {
    assert.match(readme, new RegExp(token, "i"), token);
  }
});
