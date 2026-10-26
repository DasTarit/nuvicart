import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root,p),"utf8");
const exists = (p) => fs.existsSync(path.join(root,p));
const allSource = () => {
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(path.join(root,d),{withFileTypes:true})) {
      if (["node_modules",".next",".git","coverage"].includes(e.name)) continue;
      const rel = path.join(d,e.name);
      if (e.isDirectory()) walk(rel);
      else if (/\.(ts|tsx|js|mjs|sql|md|toml|example)$/.test(e.name)) files.push(rel);
    }
  };
  walk(".");
  return files.map(read).join("\n");
};

test("all required production environment variables are documented consistently",()=>{
  const env=read(".env.example"), runtime=read("lib/env.ts"), docs=read("docs/production.md"), runbook=read("docs/phase-9-go-live.md");
  const vars=["NEXT_PUBLIC_SUPABASE_URL","NEXT_PUBLIC_SUPABASE_ANON_KEY","NEXT_PUBLIC_SITE_URL","SUPABASE_SERVICE_ROLE_KEY","RAZORPAY_KEY_ID","RAZORPAY_KEY_SECRET","RAZORPAY_WEBHOOK_SECRET","SHIPROCKET_EMAIL","SHIPROCKET_PASSWORD","SHIPROCKET_BASE_URL","SHIPROCKET_WEBHOOK_SECRET","SHIPROCKET_PICKUP_LOCATION","SHIPROCKET_PACKAGE_WEIGHT_KG","SHIPROCKET_PACKAGE_LENGTH_CM","SHIPROCKET_PACKAGE_BREADTH_CM","SHIPROCKET_PACKAGE_HEIGHT_CM","RESEND_API_KEY","RESEND_FROM_EMAIL","RESEND_FROM_NAME"];
  for(const v of vars){assert.match(env,new RegExp(`^${v}=`,`m`)); assert.match(runtime,new RegExp(v)); assert.match(docs,new RegExp(v)); assert.match(runbook,new RegExp(v));}
});

test("server-only secrets are never NEXT_PUBLIC",()=>{
  const runtimeFiles = [
    "lib/env.ts","lib/supabase/admin.ts","lib/payments/razorpay.ts",
    "lib/shipping/shiprocket.ts","lib/email/resend.ts"
  ].map(read).join("\n");
  assert.doesNotMatch(runtimeFiles,/NEXT_PUBLIC_(?:SUPABASE_SERVICE_ROLE_KEY|RAZORPAY_KEY_SECRET|RAZORPAY_WEBHOOK_SECRET|SHIPROCKET_PASSWORD|SHIPROCKET_WEBHOOK_SECRET|RESEND_API_KEY)/);
});

test("production site URL is canonicalized to nuvicart.com",()=>{
  assert.match(read(".env.example"),/^NEXT_PUBLIC_SITE_URL=https:\/\/nuvicart\.com$/m);
  assert.match(read("lib/env.ts"),/default\("https:\/\/nuvicart\.com"\)/);
  assert.match(read("docs/phase-9-go-live.md"),/https:\/\/nuvicart\.com/);
});

test("Netlify keeps the required production build command and no secrets",()=>{
  const s=read("netlify.toml");
  assert.match(s,/command\s*=\s*"npm run build"/);
  assert.doesNotMatch(s,/^[^#]*(?:SECRET|PASSWORD|API_KEY|SERVICE_ROLE)\s*=/im);
});

test("migration set is ordered and contains the production hardening migration", () => {
  const files = fs
    .readdirSync(path.join(root, "supabase/migrations"))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  assert.ok(files.includes("202610090008_production_hardening.sql"));
  assert.ok(files.includes("202610260001_admin_product_images_edit_delete.sql"));
  assert.equal(files.length, 21);
  assert.equal(new Set(files).size, files.length);
});

test("production hardening keeps sensitive webhook/payment RPCs service-role-only",()=>{
  const s=read("supabase/migrations/202610090008_production_hardening.sql");
  for(const fn of ["finalize_razorpay_payment","claim_razorpay_webhook_event","record_shiprocket_webhook","claim_notification_delivery"]){
    assert.match(s,new RegExp(`revoke all on function public\\.${fn}\\([\\s\\S]*?from public, anon, authenticated;`));
    assert.match(s,new RegExp(`grant execute on function public\\.${fn}\\([\\s\\S]*?to service_role;`));
  }
});

test("checkout/payment/shipping webhook endpoints exist",()=>{
  for(const p of ["app/api/orders/checkout/route.ts","app/api/payments/order/route.ts","app/api/payments/verify/route.ts","app/api/payments/webhook/route.ts","app/api/shipping/shiprocket/route.ts","app/api/shipping/shiprocket/webhook/route.ts"])
    assert.ok(exists(p),p);
});

test("Razorpay webhook uses raw body, signature, provider event id, and durable claim",()=>{
  const s=read("app/api/payments/webhook/route.ts");
  assert.match(s,/await request\.text\(\)/);
  assert.match(s,/x-razorpay-signature/);
  assert.match(s,/x-razorpay-event-id/);
  assert.match(s,/claim_razorpay_webhook_event/);
});

test("Shiprocket webhook authenticates and deduplicates server-side",()=>{
  const s=read("app/api/shipping/shiprocket/webhook/route.ts");
  assert.match(s,/x-api-key/);
  assert.match(s,/timingSafeEqual/);
  assert.match(s,/record_shiprocket_webhook/);
});

test("Resend remains server-only and idempotent",()=>{
  const s=read("lib/email/resend.ts");
  assert.match(s,/server-only/);
  assert.match(s,/RESEND_API_KEY/);
  assert.match(s,/"Idempotency-Key"/);
  assert.match(s,/cache:\s*"no-store"/);
});

test("sensitive analytics response is not publicly cached",()=>{
  assert.match(read("app/api/admin/analytics/route.ts"),/Cache-Control.*private, no-store/);
});

test("private routes are excluded from robots indexing",()=>{
  const s=read("app/robots.ts");
  assert.match(s,/\/admin\//); assert.match(s,/\/account\//); assert.match(s,/\/api\//);
});

test("production security headers remain enabled",()=>{
  const s=read("next.config.ts");
  for(const h of ["Content-Security-Policy","X-Content-Type-Options","Referrer-Policy","X-Frame-Options","Permissions-Policy","Strict-Transport-Security"])
    assert.match(s,new RegExp(h));
});

test("customer/auth redirects derive from production site URL rather than localhost",()=>{
  const s=read("app/(auth)/actions.ts");
  assert.doesNotMatch(s,/localhost/);
  assert.match(s,/NEXT_PUBLIC_SITE_URL/);
});

test("no localhost dependency exists in production deployment configuration",()=>{
  for(const p of ["netlify.toml","next.config.ts","proxy.ts","app/(auth)/actions.ts"])
    assert.doesNotMatch(read(p),/localhost/);
});

test("role/admin authorization remains server-side",()=>{
  const s=read("lib/auth/admin.ts");
  assert.match(s,/auth\.getUser\(\)/);
  assert.match(s,/admin.*super_admin|super_admin.*admin/);
});

test("service-role client is isolated to server-side module",()=>{
  const s=read("lib/supabase/admin.ts");
  assert.match(s,/SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(s,/createSupabaseClient/);
  assert.match(s,/persistSession:\s*false/);
  assert.match(s,/autoRefreshToken:\s*false/);
});

test("production runbook distinguishes code-ready from deployment/provider verification",()=>{
  const s=read("docs/phase-9-go-live.md");
  assert.match(s,/CODE-READY/);
  assert.match(s,/DEPLOYMENT-CONFIGURED/);
  assert.match(s,/LIVE \/ PROVIDER-VERIFIED/);
  assert.match(s,/NOT PROVIDER-VERIFIED/);
});

test("production runbook documents provider endpoints and smoke test",()=>{
  const s=read("docs/phase-9-go-live.md");
  assert.match(s,/\/api\/payments\/webhook/);
  assert.match(s,/\/api\/shipping\/shiprocket\/webhook/);
  assert.match(s,/Deterministic smoke test/);
  assert.match(s,/Failure\/recovery tests/);
});

test("rate limiting is documented as durable/shared deployment protection, not in-memory",()=>{
  const s=read("docs/phase-9-go-live.md");
  assert.match(s,/durable\/shared/);
  assert.match(s,/Do not use an in-memory process-local limiter/);
});

test("backup and rollback claims remain verification-based",()=>{
  const s=read("docs/phase-9-go-live.md");
  assert.match(s,/backups\/PITR/);
  assert.match(s,/Do not automatically roll database migrations backward/);
});

test("no duplicate v2 commerce architecture is introduced",()=>{
  const src = [
    "app","components","features","lib","hooks","utils","supabase/migrations"
  ].flatMap(() => []).join("");
  const sourceFiles = [];
  for (const d of ["app","components","features","lib","hooks","utils","supabase/migrations"]) {
    const walk = (rel) => {
      const dir = path.join(root, rel);
      for (const e of fs.readdirSync(dir,{withFileTypes:true})) {
        const child = path.join(rel,e.name);
        if (e.isDirectory()) walk(child);
        else if (/\.(ts|tsx|sql)$/.test(e.name)) sourceFiles.push(read(child));
      }
    };
    walk(d);
  }
  assert.doesNotMatch(sourceFiles.join("\n"),/\b(?:orders|order_items|payments|payment_attempts|inventory|fulfillments|promotions)_v2\b/i);
});

test("no real secret-shaped material is present in repository",()=>{
  const src=allSource();
  assert.doesNotMatch(src,/sk_(?:live|test)_[A-Za-z0-9]{20,}/);
  assert.doesNotMatch(src,/rzp_(?:live|test)_[A-Za-z0-9]{10,}/);
  assert.doesNotMatch(src,/BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/);
  assert.doesNotMatch(src,/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/);
});

test("deployment documentation covers all manual provider configuration areas",()=>{
  const s=read("docs/phase-9-go-live.md");
  for(const section of ["Supabase Auth","Netlify","Domain / HTTPS","Razorpay verification","Shiprocket verification","Resend verification","Abuse protection","Backup and rollback"])
    assert.match(s,new RegExp(section.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
});

test("Phase 9 does not introduce new commerce feature directories",()=>{
  assert.ok(!exists("features/refunds"));
  assert.ok(!exists("features/loyalty"));
  assert.ok(!exists("features/subscriptions"));
});

test("gitignore excludes secrets and build/debug artifacts",()=>{
  const s=read(".gitignore");
  for(const x of [".env","node_modules/","*.tsbuildinfo","*.log"]) assert.match(s,new RegExp(x.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
});
