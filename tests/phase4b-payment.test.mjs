import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root = process.cwd();
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

test("Phase 4B payment foundation has dedicated persisted attempts and webhook deduplication", () => {
  const sql = read("supabase/migrations/202610080001_razorpay_payment_foundation.sql");
  for (const token of ["payment_attempts", "payment_webhook_events", "provider_order_id", "provider_payment_id", "signature_verified", "failure_reason"]) assert.match(sql, new RegExp(token));
  assert.match(sql, /unique index if not exists payment_attempts_provider_order_unique_idx/);
  assert.match(sql, /unique index if not exists payment_attempts_provider_payment_unique_idx/);
  assert.match(sql, /payment_webhook_events_provider_event_unique_idx/);
  assert.match(sql, /for update/);
});

test("Razorpay server integration uses the Orders API and server-side HMAC verification", () => {
  const razorpay = read("lib/payments/razorpay.ts");
  assert.match(razorpay, /api\.razorpay\.com\/v1/);
  assert.match(razorpay, /Basic/);
  assert.match(razorpay, /createHmac\("sha256"/);
  assert.match(razorpay, /orderId.*paymentId/);
  assert.doesNotMatch(razorpay, /NEXT_PUBLIC_RAZORPAY/);
});

test("Payment creation never accepts a browser amount and uses persisted order total", () => {
  const route = read("app/api/payments/order/route.ts");
  assert.match(route, /prepare_payment_attempt/);
  assert.match(route, /Number\(attempt\.amount\)/);
  assert.doesNotMatch(route, /body\.amount/);
});

test("Callback verification checks ownership, linkage, signature, amount, currency and captured state", () => {
  const route = read("app/api/payments/verify/route.ts");
  for (const token of ["auth.getUser", "provider_order_id", "verifyPaymentSignature", "fetchRazorpayPayment", "payment.order_id", "payment.amount", "payment.currency", 'payment.status !== "captured"', "finalize_razorpay_payment"]) assert.match(route, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("Webhook uses raw body signature verification and event-id deduplication", () => {
  const route = read("app/api/payments/webhook/route.ts");
  assert.match(route, /request\.text\(\)/);
  assert.match(route, /x-razorpay-signature/);
  assert.match(route, /x-razorpay-event-id/);
  assert.match(route, /verifyWebhookSignature/);
  assert.match(route, /payment_webhook_events/);
  assert.match(route, /duplicate/);
});

test("Secrets are server-only and are not prefixed NEXT_PUBLIC", () => {
  const env = read(".env.example");
  for (const name of ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"]) assert.match(env, new RegExp(`^${name}=`, "m"));
  assert.doesNotMatch(env, /NEXT_PUBLIC_RAZORPAY/);
  const client = read("components/storefront/checkout-review.tsx");
  assert.doesNotMatch(client, /RAZORPAY_KEY_SECRET|RAZORPAY_WEBHOOK_SECRET/);
});

test("Payment finalization is transactional, idempotent and inventory-safe", () => {
  const sql = read("supabase/migrations/202610080001_razorpay_payment_foundation.sql");
  assert.match(sql, /finalize_razorpay_payment/);
  assert.match(sql, /payment_status = 'paid'/);
  assert.match(sql, /status = 'paid'/);
  assert.match(sql, /for update/);
  assert.match(sql, /stock_quantity = stock_quantity - v_item\.quantity/);
  assert.match(sql, /INSUFFICIENT_INVENTORY_AT_PAYMENT/);
  assert.match(sql, /already_finalized/);
});

test("Retry reopens only unpaid pending-payment orders", () => {
  const sql = read("supabase/migrations/202610080001_razorpay_payment_foundation.sql");
  assert.match(sql, /reopen_failed_payment/);
  assert.match(sql, /status <> 'pending_payment' or v_order\.payment_status not in \('pending','failed'\)/);
  assert.match(sql, /old\.payment_status = 'failed'[\s\S]*new\.payment_status = 'pending'/);
  assert.doesNotMatch(sql, /orders_v2|order_items_v2|checkout_v2|cart_v2/);
});

test("Security headers allow only the minimum Razorpay browser origins", () => {
  const config = read("next.config.ts");
  assert.match(config, /checkout\.razorpay\.com/);
  assert.match(config, /api\.razorpay\.com/);
  assert.match(config, /Content-Security-Policy/);
  assert.doesNotMatch(config, /script-src[^\n]*\*/);
});

test("Payment endpoints do not expose privileged secrets", () => {
  const combined = ["app/api/payments/order/route.ts", "app/api/payments/verify/route.ts", "app/api/payments/webhook/route.ts"].map(read).join("\n");
  assert.doesNotMatch(combined, /RAZORPAY_KEY_SECRET\s*[:=]\s*[^}]+/);
  assert.doesNotMatch(combined, /RAZORPAY_WEBHOOK_SECRET\s*[:=]\s*[^}]+/);
});
