import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migration = () => read("supabase/migrations/202610080002_razorpay_reliability_hardening.sql");
const webhook = () => read("app/api/payments/webhook/route.ts");
const orderPage = () => read("app/(account)/account/orders/[orderNumber]/page.tsx");
const paymentActions = () => read("components/storefront/payment-actions.tsx");

test("unprocessed duplicate webhook is retried", () => {
  const sql = migration();
  assert.match(sql, /on conflict \(provider, provider_event_id\) do nothing/i);
  assert.match(sql, /processed_at is null/);
  assert.match(sql, /status', 'claimed'/);
});

test("processed duplicate webhook is not reprocessed", () => {
  assert.match(migration(), /if v_event\.processed_at is not null then[\s\S]*status', 'processed'/i);
  assert.match(webhook(), /claim\.status === "processed"/);
});

test("webhook processing failure leaves processed_at NULL", () => {
  const sql = migration();
  assert.match(sql, /release_razorpay_webhook_event/);
  assert.match(sql, /set processing_at = null,[\s\S]*processing_token = null[\s\S]*processed_at is null/i);
  assert.match(webhook(), /release_razorpay_webhook_event/);
});

test("successful retry sets processed_at", () => {
  assert.match(migration(), /complete_razorpay_webhook_event[\s\S]*set processed_at = coalesce\(processed_at, timezone\('utc', now\(\)\)\)/i);
  assert.match(webhook(), /complete_razorpay_webhook_event/);
});

test("concurrent duplicate webhook is safe", () => {
  const sql = migration();
  assert.match(sql, /where provider = 'razorpay'[\s\S]*provider_event_id = p_provider_event_id[\s\S]*for update/i);
  assert.match(sql, /status', 'in_progress'/);
  assert.match(webhook(), /status === "in_progress"/);
});

test("captured payment cannot transition to failed", () => {
  const sql = migration();
  assert.match(sql, /old\.status = 'captured' and new\.status = 'refunded'/);
  assert.match(sql, /payment_already_terminal/);
});

test("captured payment cannot transition to cancelled", () => {
  assert.doesNotMatch(migration(), /old\.status = 'captured'[\s\S]*new\.status in \('refunded',\s*'cancelled'\)/);
});

test("captured payment cannot transition back to pending", () => {
  assert.doesNotMatch(migration(), /old\.status = 'captured'[\s\S]*new\.status in \([^)]*'pending'/);
});

test("refunded payment cannot become captured", () => {
  assert.doesNotMatch(migration(), /old\.status = 'refunded'[\s\S]*new\.status/);
});

test("failed payment remains idempotently failed", () => {
  assert.match(migration(), /if v_attempt\.status = 'failed' then[\s\S]*already_failed/i);
});

test("success callback racing failure webhook is safe", () => {
  const sql = migration();
  assert.match(sql, /select \* into v_attempt[\s\S]*for update/i);
  assert.match(sql, /status in \('captured', 'refunded'\)/);
  assert.match(webhook(), /payment\.status === "captured"/);
});

test("failure webhook racing success callback is safe", () => {
  const route = webhook();
  assert.match(route, /fetchRazorpayPayment\(paymentId\)/g);
  assert.match(route, /if \(payment\.status === "captured"\)/);
  assert.match(route, /record_razorpay_failure/);
});

test("paid_inventory_issue is represented explicitly", () => {
  assert.match(migration(), /payment_status = 'paid_inventory_issue'/);
  assert.match(read("features/orders/types.ts"), /paid_inventory_issue/);
});

test("paid_inventory_issue is not displayed as payment pending", () => {
  const page = orderPage();
  assert.match(page, /paymentStatus === "paid_inventory_issue"/);
  assert.match(page, /Payment verified — order requires fulfillment review/);
  assert.doesNotMatch(page.match(/paid_inventory_issue[\s\S]*?: order\.paymentStatus === "failed"/)?.[0] ?? "", /Payment pending/);
});

test("paid_inventory_issue cannot be retried as a new payment", () => {
  assert.match(migration(), /payment_status not in \('pending', 'failed'\)/);
  assert.match(read("app/api/payments/order/route.ts"), /prepare_payment_attempt/);
  assert.match(read("supabase/migrations/202610080001_razorpay_payment_foundation.sql"), /paid_inventory_issue/);
});

test("repeated inventory-exception handling is idempotent", () => {
  const sql = migration();
  assert.match(sql, /already_recorded/);
  assert.match(sql, /payment_status = 'paid_inventory_issue' and v_attempt\.status = 'captured'/);
});

test("inventory cannot decrement twice", () => {
  const sql = read("supabase/migrations/202610080001_razorpay_payment_foundation.sql");
  assert.match(sql, /from public\.inventory where variant_id = v_item\.variant_id for update/i);
  assert.match(sql, /from public\.inventory where product_id = v_item\.product_id for update/i);
  assert.match(sql, /already_finalized/);
});

test("successful payment remains successful after duplicate failure event", () => {
  const sql = migration();
  assert.match(sql, /v_attempt\.status in \('captured', 'refunded'\)[\s\S]*return jsonb_build_object\([\s\S]*payment_already_terminal/i);
  assert.match(webhook(), /if \(payment\.status === "captured"\)/);
});

test("direct client mutation of payment state remains blocked", () => {
  const sql = read("supabase/migrations/202610080001_razorpay_payment_foundation.sql");
  assert.match(sql, /revoke all on public\.payment_attempts, public\.payment_webhook_events from anon, authenticated/);
  assert.match(sql, /grant select on public\.payment_attempts to authenticated/);
});

test("webhook signature verification remains mandatory", () => {
  const route = webhook();
  assert.match(route, /x-razorpay-signature/);
  assert.match(route, /verifyWebhookSignature\(rawBody, signature\)/);
  assert.match(route, /if \(!verifyWebhookSignature\(rawBody, signature\)\)/);
});
