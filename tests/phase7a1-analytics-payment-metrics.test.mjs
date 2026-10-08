import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const analytics = read("supabase/migrations/202610090006_analytics_foundation.sql");
const payment = read("supabase/migrations/202610080001_razorpay_payment_foundation.sql");
const reliability = read("supabase/migrations/202610080002_razorpay_reliability_hardening.sql");

test("retryable_failures mirrors authoritative reopen_failed_payment eligibility", () => {
  assert.match(payment, /reopen_failed_payment/);
  assert.match(payment, /v_order\.status <> 'pending_payment' or v_order\.payment_status not in \('pending','failed'\)/);
  assert.match(analytics, /pa\.status='failed'\s+and o\.status='pending_payment'\s+and o\.payment_status='failed'/);
});

test("permanently ineligible failed orders are excluded from retryable failures", () => {
  assert.match(analytics, /o\.status='pending_payment'\s+and o\.payment_status='failed'/);
  assert.doesNotMatch(analytics, /pa\.status='failed'\s+and o\.payment_status='failed'\s+and pa\.created_at/);
});

test("captured attempts are not counted as retryable failures", () => {
  const block = analytics.slice(analytics.indexOf("-- Retryable failures"), analytics.indexOf("v_success_rate :="));
  assert.match(block, /pa\.status='failed'/);
  assert.doesNotMatch(block, /pa\.status='captured'.*retryable/si);
});

test("pending attempts are not counted as retryable failures", () => {
  const block = analytics.slice(analytics.indexOf("-- Retryable failures"), analytics.indexOf("v_success_rate :="));
  assert.match(block, /pa\.status='failed'/);
  assert.doesNotMatch(block, /pa\.status='pending'.*retryable/si);
});

test("cancelled or otherwise ineligible orders are excluded", () => {
  const block = analytics.slice(analytics.indexOf("-- Retryable failures"), analytics.indexOf("v_success_rate :="));
  assert.match(block, /o\.status='pending_payment'/);
  assert.doesNotMatch(block, /o\.status='cancelled'/);
});

test("payment success rate remains captured divided by captured plus failed attempts", () => {
  assert.match(analytics, /v_captured::numeric\/\(v_captured\+v_failed_attempts\)/);
  assert.match(analytics, /payment_success_rate_percent/);
});

test("failed_attempts remains distinct from retryable_failures", () => {
  assert.match(analytics, /count\(\*\) filter \(where pa\.status='failed'\)/);
  assert.match(analytics, /'failed_attempts',v_failed_attempts/);
  assert.match(analytics, /'retryable_failures',v_failed_payment/);
});

test("analytics remains read-only", () => {
  assert.match(analytics, /get_analytics_summary/);
  assert.doesNotMatch(analytics, /insert into public\.(orders|payment_attempts|fulfillments|inventory)/i);
  assert.doesNotMatch(analytics, /update public\.(orders|payment_attempts|fulfillments|inventory)/i);
  assert.doesNotMatch(analytics, /delete from public\.(orders|payment_attempts|fulfillments|inventory)/i);
});

test("Razorpay retry behavior is unchanged", () => {
  assert.match(payment, /create or replace function public\.reopen_failed_payment/);
  assert.match(payment, /status <> 'pending_payment' or v_order\.payment_status not in \('pending','failed'\)/);
  assert.match(payment, /update public\.orders set payment_status = 'pending'/);
});

test("Phase 7A analytics authorization remains centralized", () => {
  assert.match(analytics, /public\.require_admin_actor\(\)/);
  assert.match(analytics, /revoke all on function public\.get_analytics_summary/);
  assert.match(analytics, /grant execute on function public\.get_analytics_summary.*authenticated/);
});

test("No duplicate analytics/payment schema is introduced", () => {
  assert.doesNotMatch(analytics, /(?:orders|payments|payment_attempts)_analytics_v2/i);
  assert.doesNotMatch(analytics, /create table/i);
});

test("Phase 4B inventory-exception semantics remain intact", () => {
  assert.match(reliability, /paid_inventory_issue/);
  assert.match(payment, /record_razorpay_inventory_exception/);
});
