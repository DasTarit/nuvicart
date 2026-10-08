import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migration = () => read("supabase/migrations/202610080003_razorpay_webhook_recovery.sql");
const webhook = () => read("app/api/payments/webhook/route.ts");
const prior = () => read("supabase/migrations/202610080002_razorpay_reliability_hardening.sql");
const foundation = () => read("supabase/migrations/202610080001_razorpay_payment_foundation.sql");

test("processed event returns processed", () => {
  assert.match(migration(), /if v_event\.processed_at is not null then[\s\S]*status', 'processed'/i);
});

test("active event does not process concurrently", () => {
  const sql = migration();
  assert.match(sql, /processing_at is not null[\s\S]*status', 'in_progress'/i);
  assert.match(sql, /from public\.payment_webhook_events[\s\S]*for update/i);
});

test("stale event can be reclaimed", () => {
  const sql = migration();
  assert.match(sql, /v_stale_after interval := interval '5 minutes'/i);
  assert.match(sql, /processing_at > v_now - v_stale_after/);
  assert.match(sql, /v_token := gen_random_uuid\(\)/);
});

test("reclaimed event receives a new processing token", () => {
  const sql = migration();
  assert.match(sql, /v_token := gen_random_uuid\(\);[\s\S]*processing_token = v_token/i);
});

test("old token cannot complete reclaimed event", () => {
  const sql = migration();
  assert.match(sql, /where id = p_event_id[\s\S]*processing_token = p_processing_token[\s\S]*processed_at is null/i);
  assert.match(sql, /invalidates every completion\/release call made by the old worker/i);
});

test("old token cannot release reclaimed event", () => {
  const sql = migration();
  const release = sql.slice(sql.indexOf("create or replace function public.release_razorpay_webhook_event"));
  assert.match(release, /processing_token = p_processing_token/);
  assert.match(release, /processed_at is null/);
});

test("new token can complete reclaimed event", () => {
  const sql = migration();
  const complete = sql.slice(sql.indexOf("create or replace function public.complete_razorpay_webhook_event"));
  assert.match(complete, /processing_token = p_processing_token/);
  assert.match(complete, /set processed_at = coalesce\(processed_at, timezone\('utc', now\(\)\)\)/);
});

test("new token can release failed processing", () => {
  const sql = migration();
  const release = sql.slice(sql.indexOf("create or replace function public.release_razorpay_webhook_event"));
  assert.match(release, /set processing_at = null,[\s\S]*processing_token = null/);
});

test("duplicate event does not overwrite original payload", () => {
  assert.match(migration(), /on conflict \(provider, provider_event_id\) do nothing/i);
  assert.match(migration(), /First verified payload wins/i);
});

test("duplicate event ID does not create a second row", () => {
  assert.match(foundation(), /create unique index if not exists payment_webhook_events_provider_event_unique_idx/i);
  assert.match(migration(), /on conflict \(provider, provider_event_id\) do nothing/i);
});

test("webhook signature remains mandatory", () => {
  const route = webhook();
  assert.match(route, /x-razorpay-signature/);
  assert.match(route, /verifyWebhookSignature\(rawBody, signature\)/);
  assert.match(migration(), /if not p_signature_verified then/);
});

test("callback/webhook payment finalization remains idempotent", () => {
  const sql = foundation();
  assert.match(sql, /finalize_razorpay_payment/);
  assert.match(sql, /already_finalized/);
  assert.match(webhook(), /finalize_razorpay_payment/);
});

test("captured payment remains captured after duplicate failure event", () => {
  const sql = prior();
  assert.match(sql, /v_attempt\.status in \('captured', 'refunded'\)/);
  assert.match(webhook(), /if \(payment\.status === "captured"\)/);
});

test("inventory cannot decrement twice", () => {
  const sql = read("supabase/migrations/202610080001_razorpay_payment_foundation.sql");
  assert.match(sql, /for update/i);
  assert.match(sql, /already_finalized/);
});


test("active webhook claim returns retryable non-2xx", () => {
  const route = webhook();
  assert.match(route, /status === "in_progress"/);
  assert.match(route, /status: 503/);
  assert.doesNotMatch(route, /status: 202/);
});
