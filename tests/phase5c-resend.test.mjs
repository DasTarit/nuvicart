import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/202610090004_notification_engine.sql");
const types = read("lib/email/types.ts");
const resend = read("lib/email/resend.ts");
const dev = read("lib/email/development.ts");
const provider = read("lib/email/provider.ts");
const worker = read("lib/email/worker.ts");
const templates = read("lib/email/templates/index.ts");
const env = read("lib/env.ts");
const envExample = read(".env.example");
const adminRoute = read("app/api/admin/notifications/route.ts");
const adminPage = read("app/admin/notifications/page.tsx");
const files = (dir) => fs.readdirSync(path.join(root, dir)).map((f) => path.join(dir, f));

test("EmailProvider abstraction exists", () => {
  assert.match(types, /export interface EmailProvider/);
  assert.match(types, /sendTransactionalEmail/);
});
test("Resend implements EmailProvider", () => assert.match(resend, /resendEmailProvider:\s*EmailProvider/));
test("development/no-op provider is available and performs no network call", () => {
  assert.match(dev, /developmentEmailProvider:\s*EmailProvider/);
  assert.doesNotMatch(dev, /fetch\(/);
});
test("Resend credentials are server-only", () => {
  assert.match(resend, /import ["']server-only["']/);
  assert.match(env, /RESEND_API_KEY/);
  assert.match(env, /RESEND_FROM_EMAIL/);
});
test("no NEXT_PUBLIC Resend secret exists", () => {
  assert.doesNotMatch(env, /NEXT_PUBLIC_RESEND_API_KEY/);
  assert.doesNotMatch(envExample, /NEXT_PUBLIC_RESEND_API_KEY/);
  assert.doesNotMatch(resend, /NEXT_PUBLIC_RESEND_API_KEY/);
});
test("official Resend endpoint and server authorization are used", () => {
  assert.match(resend, /https:\/\/api\.resend\.com\/emails/);
  assert.match(resend, /authorization:\s*`Bearer \$\{apiKey\}`/);
  assert.match(resend, /"Idempotency-Key"/);
});
test("Resend timeout, 4xx, 5xx and malformed responses are normalized", () => {
  assert.match(resend, /RESEND_TIMEOUT/);
  assert.match(resend, /RESEND_NETWORK_ERROR/);
  assert.match(resend, /RESEND_PROVIDER_TEMPORARY/);
  assert.match(resend, /RESEND_PROVIDER_4XX/);
  assert.match(resend, /RESEND_AUTHENTICATION/);
  assert.match(resend, /RESEND_MALFORMED_RESPONSE/);
});
test("Resend provider does not log secrets or authorization headers", () => {
  assert.doesNotMatch(resend, /console\.(log|error|warn|info)/);
  assert.doesNotMatch(resend, /console\.(log|error|warn|info).*apiKey/i);
});
test("notification event table exists with durable delivery fields", () => {
  assert.match(migration, /create table if not exists public\.notification_events/);
  for (const field of ["event_key", "user_id", "order_id", "event_type", "payload", "delivery_status", "provider", "provider_message_id", "attempt_count", "last_attempted_at", "sent_at", "failure_reason", "created_at", "updated_at"]) assert.match(migration, new RegExp(`\\b${field}\\b`));
});
test("canonical notification event types are constrained", () => {
  for (const type of ["order_confirmation", "payment_success", "payment_failure", "shipment_created", "shipment_tracking_updated", "order_delivered", "order_cancelled"]) assert.match(migration, new RegExp(`'${type}'`));
});
test("database uniqueness protects duplicate logical events", () => {
  assert.match(migration, /event_key text not null unique/);
  assert.match(migration, /on conflict \(event_key\) do nothing/);
});
test("deterministic event identities are used", () => {
  for (const key of [":order_confirmation", ":payment_success", ":payment_failure", ":shipment_created", ":order_delivered", ":order_cancelled"]) assert.match(migration, new RegExp(`new\\.id::text \\|\\| '${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(migration, /shipment_tracking_updated/);
});
test("order confirmation trigger is deferred until the complete checkout snapshot exists", () => {
  assert.match(migration, /create constraint trigger orders_notification_confirmation_trigger/);
  assert.match(migration, /deferrable initially deferred/);
});
test("order confirmation uses immutable order and item snapshots", () => {
  assert.match(migration, /build_order_notification_payload/);
  assert.match(migration, /order_items oi/);
  assert.match(migration, /oi\.product_name/);
  assert.match(migration, /shipping_address_snapshot/);
});
test("payment success is generated only from authoritative paid state", () => {
  assert.match(migration, /old\.payment_status is distinct from new\.payment_status\s+and new\.payment_status='paid'/i);
  assert.doesNotMatch(migration, /notification_insert\([^\n]*payment_success[^\n]*pending/);
});
test("payment failure is generated only from failed payment state", () => assert.match(migration, /old\.payment_status is distinct from new\.payment_status\s+and new\.payment_status='failed'/i));
test("shipment-created requires the persisted fulfillment transition to shipped", () => assert.match(migration, /old\.status <> new\.status and new\.status='shipped'/));
test("shipment retry cannot create duplicate shipment events", () => {
  assert.match(migration, /new\.id::text \|\| ':shipment_created'/);
  assert.match(migration, /event_key text not null unique/);
});
test("delivery event is idempotent", () => assert.match(migration, /new\.id::text \|\| ':order_delivered'/));
test("cancellation event is idempotent", () => assert.match(migration, /new\.id::text \|\| ':order_cancelled'/));
test("notification failure cannot mutate order state", () => {
  assert.doesNotMatch(worker, /update\s+public\.orders/i);
  assert.doesNotMatch(migration.match(/create or replace function public\.(claim_notification_delivery|complete_notification_delivery|fail_notification_delivery)[\s\S]*?comment on table public\.notification_events/)?.[0] ?? "", /update\s+public\.(orders|payment_attempts|fulfillments)/i);
});
test("notification failure cannot mutate payment state", () => assert.doesNotMatch(worker, /payment_status|payment_attempts/));
test("notification failure cannot mutate fulfillment state", () => assert.doesNotMatch(worker, /fulfillment_status|fulfillments/));
test("stale notification workers are rejected", () => {
  assert.match(migration, /STALE_NOTIFICATION_WORKER/);
  assert.match(migration, /processing_token is distinct from p_processing_token/);
  assert.match(migration, /interval '5 minutes'/);
});
test("retryable provider failures are bounded and scheduled", () => {
  assert.match(migration, /p_failure_kind not in \('retryable','permanent'\)/);
  assert.match(migration, /attempt_count < 5/);
  assert.match(migration, /next_attempt_at=v_next/);
});
test("permanent failures do not retry forever", () => {
  assert.match(migration, /failure_kind='permanent'/);
  assert.match(migration, /delivery_status=case when v_kind='retryable' then 'pending' else 'failed' end/);
});
test("provider message ID is populated only by server delivery completion", () => {
  assert.match(worker, /complete_notification_delivery/);
  assert.match(migration, /provider_message_id=p_provider_message_id/);
  assert.doesNotMatch(adminRoute, /provider_message_id.*request\.json|body.*provider_message_id/);
});
test("customer notification access is owner-scoped", () => assert.match(migration, /auth\.uid\(\) = user_id/));
test("customer cannot mutate notification state", () => {
  assert.match(migration, /revoke insert, update, delete on public\.notification_events from anon, authenticated/);
});
test("admin notification access is restricted", () => {
  assert.match(adminRoute, /role !== "admin" && role !== "super_admin"/);
  assert.match(adminPage, /role !== "admin" && role !== "super_admin"/);
});
test("admin view exposes operational fields but not payload secrets", () => {
  assert.match(adminPage, /event_type/);
  assert.match(adminPage, /provider_message_id/);
  assert.match(adminPage, /failure_reason/);
  assert.doesNotMatch(adminPage, /payload/);
  assert.doesNotMatch(adminPage, /recipient_email/);
});
test("email payload templates are validated and do not contain secrets", () => {
  assert.match(templates, /z\.object/);
  assert.doesNotMatch(templates, /RESEND_API_KEY|RAZORPAY_KEY_SECRET|SHIPROCKET_PASSWORD|authorization/i);
});
test("historical fulfillment snapshots are used for shipping emails", () => {
  assert.match(migration, /shipping_address_snapshot/);
  assert.match(migration, /trackingNumber.*v_f\.tracking_number/);
});
test("Resend API key never enters the browser through public env", () => {
  assert.match(env, /const publicEnvSchema/);
  assert.doesNotMatch(env.split('const publicEnvSchema')[1].split('const serverEnvSchema')[0], /RESEND/);
});
test("Razorpay regression tests remain present", () => {
  for (const f of ["tests/phase4b-payment.test.mjs", "tests/phase4b1-reliability.test.mjs", "tests/phase4b2-webhook-recovery.test.mjs"]) assert.ok(fs.existsSync(path.join(root, f)));
});
test("Phase 5A/5B/5B.1/5B.1.2 regression tests remain present", () => {
  for (const f of ["tests/phase5a-fulfillment.test.mjs", "tests/phase5b-shiprocket.test.mjs", "tests/phase5b1-shiprocket-reliability.test.mjs", "tests/phase5b1.2-provider-compatibility.test.mjs"]) assert.ok(fs.existsSync(path.join(root, f)));
});
test("no duplicate order/payment/fulfillment schema is introduced", () => {
  assert.equal((migration.match(/create table if not exists public\.orders/g) ?? []).length, 0);
  assert.equal((migration.match(/create table if not exists public\.payment_attempts/g) ?? []).length, 0);
  assert.equal((migration.match(/create table if not exists public\.fulfillments/g) ?? []).length, 0);
});
test("notification worker is server-only and uses service-role delivery operations", () => {
  assert.match(worker, /import ["']server-only["']/);
  assert.match(worker, /createAdminClient/);
  assert.match(worker, /claim_notification_delivery/);
});
test("no Resend webhook infrastructure was added unnecessarily", () => {
  assert.equal(files("app/api").filter((f) => f.includes("resend")).length, 0);
  assert.doesNotMatch(migration, /resend.*webhook/i);
});
test("email provider remains provider-neutral outside the Resend adapter", () => {
  assert.doesNotMatch(types, /Resend/);
  assert.match(provider, /EmailProvider/);
});
test("Phase 5C migration has no credentials or API keys", () => {
  assert.doesNotMatch(migration, /RESEND_API_KEY|RAZORPAY_KEY_SECRET|SHIPROCKET_PASSWORD|Bearer\s+/i);
});
