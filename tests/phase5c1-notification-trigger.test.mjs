import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/202610090004_notification_engine.sql");

const fnStart = migration.indexOf("create or replace function public.notification_order_state_trigger()");
const fnEnd = migration.indexOf("\n$$;", fnStart);
assert.ok(fnStart >= 0 && fnEnd > fnStart, "notification order trigger function must exist");
const triggerFn = migration.slice(fnStart, fnEnd);

test("INSERT branch creates confirmation and returns before UPDATE logic", () => {
  const insertBranch = triggerFn.slice(triggerFn.indexOf("if tg_op = 'INSERT' then"), triggerFn.indexOf("end if;", triggerFn.indexOf("if tg_op = 'INSERT' then")) + 6);
  assert.match(insertBranch, /notification_insert\([^;]*order_confirmation/);
  assert.match(insertBranch, /return new;/);
});

test("INSERT execution path has no OLD reference before its early return", () => {
  const start = triggerFn.indexOf("if tg_op = 'INSERT' then");
  const end = triggerFn.indexOf("return new;", start);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(triggerFn.slice(start, end), /\bold\b/i);
});

test("UPDATE-only path safely uses OLD after INSERT return", () => {
  const updatePath = triggerFn.slice(triggerFn.indexOf("return new;") + "return new;".length);
  assert.match(updatePath, /old\.payment_status is distinct from new\.payment_status/i);
  assert.match(updatePath, /old\.status is distinct from new\.status/i);
});

test("deferred order confirmation trigger remains intact", () => {
  const trigger = migration.match(/create constraint trigger orders_notification_confirmation_trigger[\s\S]*?execute function public\.notification_order_state_trigger\(\);/);
  assert.ok(trigger);
  assert.match(trigger[0], /after insert on public\.orders/i);
  assert.match(trigger[0], /deferrable initially deferred/i);
});

test("confirmation event remains deterministic", () => {
  assert.match(triggerFn, /new\.id::text \|\| ':order_confirmation'/);
  assert.match(migration, /event_key text not null unique/);
});

test("payment success remains update-only", () => {
  assert.match(triggerFn, /old\.payment_status is distinct from new\.payment_status[\s\S]*?new\.payment_status='paid'/i);
  const insertPart = triggerFn.slice(triggerFn.indexOf("if tg_op = 'INSERT' then"), triggerFn.indexOf("return new;") + "return new;".length);
  assert.doesNotMatch(insertPart, /payment_success/);
});

test("payment failure remains update-only", () => {
  assert.match(triggerFn, /old\.payment_status is distinct from new\.payment_status[\s\S]*?new\.payment_status='failed'/i);
  const insertPart = triggerFn.slice(triggerFn.indexOf("if tg_op = 'INSERT' then"), triggerFn.indexOf("return new;") + "return new;".length);
  assert.doesNotMatch(insertPart, /payment_failure/);
});

test("cancellation remains update-only", () => {
  assert.match(triggerFn, /old\.status is distinct from new\.status[\s\S]*?new\.status='cancelled'/i);
  const insertPart = triggerFn.slice(triggerFn.indexOf("if tg_op = 'INSERT' then"), triggerFn.indexOf("return new;") + "return new;".length);
  assert.doesNotMatch(insertPart, /order_cancelled/);
});

test("notification trigger does not mutate orders", () => {
  assert.doesNotMatch(triggerFn, /update\s+public\.orders/i);
});

test("notification trigger does not mutate payment state", () => {
  assert.doesNotMatch(triggerFn, /update\s+public\.(payment_attempts|payments)/i);
});

test("notification trigger does not mutate fulfillment state", () => {
  assert.doesNotMatch(triggerFn, /update\s+public\.fulfillments/i);
});

test("existing Phase 5C tests remain present", () => {
  assert.ok(fs.existsSync(path.join(root, "tests/phase5c-resend.test.mjs")));
});

test("Phase 5A tests remain present", () => {
  assert.ok(fs.existsSync(path.join(root, "tests/phase5a-fulfillment.test.mjs")));
});

test("Phase 5B tests remain present", () => {
  assert.ok(fs.existsSync(path.join(root, "tests/phase5b-shiprocket.test.mjs")));
});

test("Phase 5B.1 tests remain present", () => {
  assert.ok(fs.existsSync(path.join(root, "tests/phase5b1-shiprocket-reliability.test.mjs")));
});

test("Phase 5B.1.2 provider compatibility tests remain present", () => {
  assert.ok(fs.existsSync(path.join(root, "tests/phase5b1.2-provider-compatibility.test.mjs")));
});

test("Razorpay tests remain present", () => {
  for (const f of ["tests/phase4b-payment.test.mjs", "tests/phase4b1-reliability.test.mjs", "tests/phase4b2-webhook-recovery.test.mjs"]) {
    assert.ok(fs.existsSync(path.join(root, f)));
  }
});

test("no duplicate notification table is introduced", () => {
  const tables = [...migration.matchAll(/create table(?: if not exists)? public\.(\w+)/gi)].map((m) => m[1]);
  assert.equal(tables.filter((name) => name === "notification_events").length, 1);
});
