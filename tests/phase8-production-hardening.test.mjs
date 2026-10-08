import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const files = () => fs.readdirSync(path.join(ROOT, "supabase/migrations")).filter(f => f.endsWith(".sql")).sort();
const allSource = () => {
  const out = [];
  for (const p of [
    ...files().map(f => `supabase/migrations/${f}`),
    "next.config.ts","proxy.ts",".env.example",".gitignore",
    "lib/env.ts","lib/supabase/admin.ts","lib/payments/razorpay.ts",
    "lib/shipping/shiprocket.ts","lib/email/resend.ts",
    "lib/auth/admin.ts","features/promotions/service.ts"
  ]) if (fs.existsSync(path.join(ROOT,p))) out.push(read(p));
  return out.join("\n");
};

test("production hardening migration exists and does not create v2 commerce tables", () => {
  const s = read("supabase/migrations/202610090008_production_hardening.sql");
  assert.match(s, /revoke all on function/i);
  assert.doesNotMatch(s, /create\s+table[^;]*(orders|payments|inventory|products|fulfillments|promotions)_v2/i);
});

test("customer/admin separation remains server-authoritative", () => {
  assert.match(read("lib/auth/admin.ts"), /auth\.getUser/);
  assert.match(read("lib/auth/admin.ts"), /profiles/);
  assert.match(read("lib/auth/admin.ts"), /admin.*super_admin|super_admin.*admin/s);
  assert.match(read("app/admin/layout.tsx"), /requireAdminPage/);
});

test("IDOR-sensitive customer records are scoped by authenticated identity", () => {
  const s = read("features/customer/supabase-repository.ts");
  assert.match(s, /eq\("user_id", user\.id\)/g);
  assert.match(s, /eq\("user_id", user\.id\)/);
});

test("payment verification uses authenticated/RLS-scoped attempt lookup and provider association", () => {
  const s = read("app/api/payments/verify/route.ts");
  assert.match(s, /auth\.getUser/);
  assert.match(s, /eq\("order_id", body\.orderId\)/);
  assert.match(s, /provider_order_id !== body\.razorpay_order_id/);
  assert.match(s, /verifyPaymentSignature/);
  assert.match(s, /fetchRazorpayPayment/);
});

test("role escalation protection remains in database trigger", () => {
  const s = read("supabase/migrations/202610070002_harden_profile_role_updates.sql");
  assert.match(s, /new\.role is distinct from old\.role/i);
  assert.match(s, /service_role/i);
  assert.match(s, /raise exception/i);
});

test("service-role key is server-only", () => {
  assert.doesNotMatch(read("lib/supabase/admin.ts"), /use client/i);
  assert.doesNotMatch(allSource(), /NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY/i);
  assert.match(read(".env.example"), /SUPABASE_SERVICE_ROLE_KEY=/);
});

test("SECURITY DEFINER hardening removes public/anon execution from sensitive RPCs", () => {
  const s = read("supabase/migrations/202610090008_production_hardening.sql");
  for (const fn of [
    "create_order_from_cart","prepare_payment_attempt","finalize_razorpay_payment",
    "get_analytics_summary","admin_create_product","admin_update_promotion",
    "claim_shiprocket_creation","claim_notification_delivery"
  ]) assert.match(s, new RegExp(`revoke all on function public\\.${fn}\\(`));
  assert.match(s, /grant execute on function public\.finalize_razorpay_payment[\s\S]*to service_role/i);
  assert.match(s, /grant execute on function public\.claim_notification_delivery[\s\S]*to service_role/i);
});

test("webhook authenticity and raw-body verification remain present", () => {
  const razor = read("app/api/payments/webhook/route.ts");
  const ship = read("app/api/shipping/shiprocket/webhook/route.ts");
  assert.match(razor, /request\.text\(\)/);
  assert.match(razor, /verifyWebhookSignature/);
  assert.match(razor, /x-razorpay-signature/i);
  assert.match(ship, /request\.text\(\)/);
  assert.match(ship, /timingSafeEqual/);
  assert.match(ship, /SHIPROCKET_WEBHOOK_SECRET/);
});

test("Razorpay webhook has durable claim/replay and stale-worker handling", () => {
  const route = read("app/api/payments/webhook/route.ts");
  const sql = read("supabase/migrations/202610080003_razorpay_webhook_recovery.sql");
  assert.match(route, /claim_razorpay_webhook_event/);
  assert.match(route, /processed/);
  assert.match(route, /in_progress/);
  assert.match(sql, /processing_token/);
  assert.match(sql, /interval '5 minutes'/i);
});

test("Razorpay amount remains server-authoritative", () => {
  const s = read("app/api/payments/verify/route.ts");
  assert.match(s, /payment\.amount !== Math\.round\(Number\(attempt\.amount\) \* 100\)/);
  assert.match(s, /finalize_razorpay_payment/);
  assert.doesNotMatch(s, /body\.(amount|grandTotal|discount)/);
});

test("inventory finalization is protected against duplicate payment finalization", () => {
  const s = read("supabase/migrations/202610080001_razorpay_payment_foundation.sql") +
    read("supabase/migrations/202610080002_razorpay_reliability_hardening.sql");
  assert.match(s, /for update/i);
  assert.match(s, /paid_inventory_issue/i);
  assert.match(s, /inventory/);
});

test("promotion concurrency and final revalidation remain database-authoritative", () => {
  const s = read("supabase/migrations/202610090007_promotions_foundation.sql");
  assert.match(s, /for update/i);
  assert.match(s, /calculate_promotion_for_lines\(p_promotion_code/i);
  assert.match(s, /promotion_redemptions/);
  assert.match(s, /promotion_redemptions_order_unique_idx/);
  assert.match(s, /discount_total/);
});

test("promotion limits and restrictions remain server-side", () => {
  const s = read("features/promotions/service.ts") + read("supabase/migrations/202610090007_promotions_foundation.sql");
  assert.match(s, /minimum_order_value/);
  assert.match(s, /maximum_discount/);
  assert.match(s, /per_customer_limit/);
  assert.match(s, /restriction_type/);
  assert.match(s, /upper\(trim/);
});

test("shipping duplicate prevention and stale worker protection remain intact", () => {
  const s = read("supabase/migrations/202610090003_shiprocket_idempotency_hardening.sql") +
    read("app/api/shipping/shiprocket/route.ts");
  assert.match(s, /provider_order_id/);
  assert.match(s, /processing_token/);
  assert.match(s, /findShipmentByReference/);
  assert.match(s, /record_shiprocket_provider_order/);
});

test("notification duplicate prevention and stale worker protection remain intact", () => {
  const s = read("supabase/migrations/202610090004_notification_engine.sql") + read("lib/email/worker.ts");
  assert.match(s, /event_key/);
  assert.match(s, /processing_token/);
  assert.match(s, /claim_notification_delivery/);
  assert.match(s, /complete_notification_delivery/);
  assert.match(s, /fail_notification_delivery/);
});

test("notification failure cannot mutate commerce state", () => {
  const s = read("supabase/migrations/202610090004_notification_engine.sql");
  const notificationFunctions = s.match(/create or replace function public\.(claim_notification_delivery|complete_notification_delivery|fail_notification_delivery)[\s\S]*?(?=\ncreate or replace function|\ncomment on|\Z)/gi)?.join("\n") ?? "";
  assert.doesNotMatch(notificationFunctions, /update\s+public\.(orders|payment_attempts|fulfillments|inventory)/i);
});

test("SECURITY DEFINER functions pin search_path", () => {
  const chunks = allSource().split(/create(?: or replace)? function public\./i).slice(1);
  const offenders = chunks.filter(c => /security definer/i.test(c.slice(0, 2500)) && !/set search_path\s*=/i.test(c.slice(0,2500)));
  assert.deepEqual(offenders, []);
});

test("RLS is enabled on sensitive commerce tables", () => {
  const s = files().map(f => read(`supabase/migrations/${f}`)).join("\n");
  for (const table of ["profiles","customer_addresses","carts","cart_items","products","product_variants","inventory","orders","order_items","payment_attempts","fulfillments","promotion_redemptions","notification_events","admin_audit_log"]) {
    assert.match(s, new RegExp(`alter table public\\.${table} enable row level security`, "i"), table);
  }
});

test("admin audit is immutable to browser roles", () => {
  const s = read("supabase/migrations/202610090005_admin_operations.sql");
  assert.match(s, /revoke insert, update, delete on public\.admin_audit_log from anon, authenticated/i);
  assert.match(s, /require_admin_actor/);
});

test("private routes are protected from crawler indexing", () => {
  const robots = read("app/robots.ts");
  const adminLayout = read("app/admin/layout.tsx");
  const accountLayout = read("app/(account)/layout.tsx");
  assert.match(robots, /\/admin\//);
  assert.match(robots, /\/account\//);
  assert.match(robots, /\/api\//);
  assert.match(adminLayout, /index:\s*false/);
  assert.match(accountLayout, /index:\s*false/);
});

test("HTTP security headers include baseline hardening", () => {
  const s = read("next.config.ts");
  for (const h of ["Content-Security-Policy","X-Content-Type-Options","Referrer-Policy","X-Frame-Options","Permissions-Policy","Strict-Transport-Security"]) {
    assert.match(s, new RegExp(h));
  }
  assert.match(s, /poweredByHeader:\s*false/);
});
test("CSP permits the configured Supabase origin for browser authentication", () => {
  const s = read("next.config.ts");
  assert.match(s, /NEXT_PUBLIC_SUPABASE_URL/);
  assert.match(s, /connectSrc/);
  assert.match(s, /frame-ancestors 'self'/);
});

test("private analytics/admin API responses are not publicly cached", () => {
  assert.match(read("app/api/admin/analytics/route.ts"), /private, no-store/);
  assert.match(read("app/api/admin/notifications/route.ts"), /requireAdmin/);
});

test("customer-specific browser fetches explicitly use no-store where applicable", () => {
  assert.match(read("app/api/admin/analytics/route.ts"), /no-store/);
  assert.match(read("components/providers/customer-sync-provider.tsx"), /cache:\s*"no-store"/);
});

test("API inputs use bounded/whitelisted values instead of arbitrary SQL", () => {
  const s = allSource();
  assert.doesNotMatch(s, /order\s+by\s+\$\{.*\}|select\s+\$\{.*\}|from\s+\$\{.*\}/i);
  assert.doesNotMatch(s, /raw\s*sql|arbitrary\s+sql/i);
});

test("error responses sanitize payment/webhook failures", () => {
  for (const f of ["app/api/payments/order/route.ts","app/api/payments/verify/route.ts","app/api/payments/webhook/route.ts","app/api/shipping/shiprocket/webhook/route.ts"]) {
    const s=read(f);
    assert.doesNotMatch(s, /return NextResponse\.json\(\{\s*error:\s*error\.message/i);
  }
});

test("no real secrets are present in source or environment files", () => {
  const env = read(".env.example");
  const runtime = [
    "lib/env.ts","lib/supabase/admin.ts","lib/supabase/server.ts",
    "lib/payments/razorpay.ts","lib/shipping/shiprocket.ts","lib/email/resend.ts"
  ].map(read).join("\\n");
  assert.doesNotMatch(env, /NEXT_PUBLIC_(?:RAZORPAY|SHIPROCKET|RESEND).*SECRET|NEXT_PUBLIC_.*SERVICE_ROLE/i);
  assert.doesNotMatch(runtime, /process\.env\.NEXT_PUBLIC_(?:RAZORPAY|SHIPROCKET|RESEND|SUPABASE_SERVICE_ROLE)/i);
  assert.doesNotMatch(runtime, /rzp_(?:live|test)_[A-Za-z0-9]+/i);
  assert.doesNotMatch(runtime, /eyJ[A-Za-z0-9_-]{30,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}/);
});

test("historical order snapshots remain authoritative", () => {
  const s = read("supabase/migrations/202610070006_order_engine.sql") +
    read("supabase/migrations/202610090007_promotions_foundation.sql");
  assert.match(s, /order_items/);
  assert.match(s, /product_name/);
  assert.match(s, /promotion_code_snapshot/);
});

test("order and fulfillment state transitions remain database-controlled", () => {
  const order = read("supabase/migrations/202610070007_order_engine_hardening.sql");
  const fulfillment = read("supabase/migrations/202610090001_fulfillment_foundation.sql");
  assert.match(order, /validate_order_state_transition/);
  assert.match(fulfillment, /validate_fulfillment_status_transition/);
});

test("no duplicate commerce architecture exists", () => {
  const s = files().map(f => read(`supabase/migrations/${f}`)).join("\n");
  assert.doesNotMatch(s, /create\s+table\s+public\.(?:orders|order_items|payments|payment_attempts|inventory|fulfillments|products|promotions)_v2/i);
});

test("production documentation distinguishes code-ready from deployment-configured", () => {
  const s = read("docs/production.md");
  assert.match(s, /CODE-READY/);
  assert.match(s, /DEPLOYMENT-CONFIGURED/);
  assert.match(s, /Razorpay/);
  assert.match(s, /Shiprocket/);
  assert.match(s, /Resend/);
  assert.match(s, /backup/i);
  assert.match(s, /rollback/i);
});

test("production documentation requires shared rate limiting rather than an in-memory limiter", () => {
  const s = read("docs/production.md");
  assert.match(s, /in-memory process-local rate limiter/i);
  assert.match(s, /durable\/shared edge/i);
  assert.match(s, /payment initialization/i);
  assert.match(s, /checkout/i);
});

test("existing complete test suite remains represented by package test command", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts.test, "node --test");
});
