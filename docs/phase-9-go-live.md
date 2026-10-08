# Nuvicart Phase 9 — Deployment Integration & Go-Live Runbook

## Status terminology

- **CODE-READY:** repository security/reliability checks pass and no known code blocker remains.
- **DEPLOYMENT-CONFIGURED:** the real Supabase, Netlify, DNS, Razorpay, Shiprocket and Resend settings have been configured and verified.
- **LIVE / PROVIDER-VERIFIED:** a real deployment is reachable and provider test transactions/events have been observed end-to-end.

Phase 9 cannot claim DEPLOYMENT-CONFIGURED or LIVE / PROVIDER-VERIFIED without access to the actual production accounts and deployment.

## 0. External deployment verification snapshot

Checked on 2026-10-08: `https://nuvicart.com` currently serves a Hostinger parked-domain page rather than the Nuvicart application. This means the public domain is **not yet LIVE / PROVIDER-VERIFIED** and the DNS/Netlify cutover remains a manual deployment task.

This observation is intentionally recorded as a launch blocker; the repository does not claim control of the current DNS/hosting configuration.

## 1. Environment variables

### Public/browser-safe
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SITE_URL` — production: `https://nuvicart.com`

### Server-only
- `SUPABASE_SERVICE_ROLE_KEY`
- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`
- `SHIPROCKET_EMAIL`
- `SHIPROCKET_PASSWORD`
- `SHIPROCKET_BASE_URL`
- `SHIPROCKET_WEBHOOK_SECRET`
- `SHIPROCKET_PICKUP_LOCATION`
- `SHIPROCKET_PACKAGE_WEIGHT_KG`
- `SHIPROCKET_PACKAGE_LENGTH_CM`
- `SHIPROCKET_PACKAGE_BREADTH_CM`
- `SHIPROCKET_PACKAGE_HEIGHT_CM`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `RESEND_FROM_NAME`

No server-only variable may use a `NEXT_PUBLIC_` prefix.

## 2. Fresh Supabase migration order

Apply exactly in filename order:

1. `202610070001_profiles_roles.sql`
2. `202610070002_harden_profile_role_updates.sql`
3. `202610070003_catalog_foundation.sql`
4. `202610070004_production_catalog.sql`
5. `202610070005_customer_persistence.sql`
6. `202610070006_order_engine.sql`
7. `202610070007_order_engine_hardening.sql`
8. `202610070008_order_transaction_consistency.sql`
9. `202610080001_razorpay_payment_foundation.sql`
10. `202610080002_razorpay_reliability_hardening.sql`
11. `202610080003_razorpay_webhook_recovery.sql`
12. `202610090001_fulfillment_foundation.sql`
13. `202610090002_shiprocket_integration.sql`
14. `202610090003_shiprocket_idempotency_hardening.sql`
15. `202610090004_notification_engine.sql`
16. `202610090005_admin_operations.sql`
17. `202610090006_analytics_foundation.sql`
18. `202610090007_promotions_foundation.sql`
19. `202610090008_production_hardening.sql`

Do not reset or destructively recreate an existing production database. For a fresh project, use the migrations through the normal Supabase migration mechanism and verify the resulting schema before traffic is enabled.

## 3. Supabase Auth

Production Supabase Auth settings must include:
- Site URL: `https://nuvicart.com`
- Password-reset redirect: `https://nuvicart.com/account`
- Signup confirmation redirect: `https://nuvicart.com/login`
- Production origin(s) only; remove localhost from production allowlists unless deliberately required for an approved development environment.

Verify the exact redirect/origin configuration in the real Supabase project before launch.

## 4. Netlify

`netlify.toml` keeps the required build command:

```text
npm run build
```

Configure the environment variables in Netlify's production environment; do not put secrets in `netlify.toml`.

Verify:
- production branch/repository
- build command
- deployment context
- Next.js runtime/API route support
- environment variables
- deploy previews do not receive production secrets unless intentionally configured
- custom domain and TLS

## 5. Domain / HTTPS

Canonical origin:

`https://nuvicart.com`

Required manual verification:
- DNS points to the intended Netlify site.
- HTTPS certificate is issued and valid.
- Canonical www/non-www behavior is chosen and tested.
- `NEXT_PUBLIC_SITE_URL` exactly matches the canonical origin.
- HSTS is appropriate for the chosen HTTPS-only deployment.

This repository does not claim DNS or TLS has been configured.

## 6. Razorpay verification

Production endpoint:

`/api/payments/webhook`

Provider verification checklist:
1. Create a real/test-mode Razorpay order through the application.
2. Confirm provider order ID is linked to the Nuvicart payment attempt.
3. Verify callback signature.
4. Deliver a signed webhook and verify raw-body signature.
5. Repeat the same webhook and confirm no duplicate payment transition.
6. Exercise a failed payment and retry.
7. Verify a captured payment cannot regress to failed.
8. Verify payment amount is derived from the persisted order.
9. Verify successful payment finalizes inventory exactly once.
10. Verify `paid_inventory_issue` remains recoverable when inventory is insufficient.
11. Verify stale webhook processing is recoverable.

Without real Razorpay credentials and provider events, status remains **CODE-READY / NOT PROVIDER-VERIFIED**.

## 7. Shiprocket verification

Production endpoint:

`/api/shipping/shiprocket/webhook`

Verify:
1. Server authentication succeeds with production credentials.
2. Shipment creation uses the stable Nuvicart order/fulfillment reference.
3. Repeating the same creation operation does not create a duplicate.
4. Timeout/recovery reconciles provider state.
5. Provider order and shipment IDs are persisted.
6. AWB assignment is reflected in fulfillment.
7. Tracking updates are authenticated and deduplicated.
8. Out-of-order events cannot regress terminal fulfillment state.

Without provider credentials/events, status remains **CODE-READY / NOT PROVIDER-VERIFIED**.

## 8. Resend verification

Configure and verify:
- API key
- verified sending domain
- sender email/name

Verify:
1. Notification event is created from authoritative business state.
2. Worker claims it with a processing token.
3. Resend receives the deterministic idempotency key.
4. Provider message ID is persisted only from the server response.
5. Temporary failure is retryable.
6. Permanent failure is bounded.
7. Stale worker cannot overwrite a newer worker.
8. Duplicate worker execution does not create duplicate logical emails.

Without a real Resend request, status remains **CODE-READY / NOT PROVIDER-VERIFIED**.

## 9. Abuse protection

Application-enforced:
- authentication and authorization
- bounded input validation
- deterministic/idempotent commerce operations
- webhook signature/authentication
- database uniqueness and transaction locking

Provider-enforced:
- Razorpay webhook authenticity and provider-side event semantics
- Shiprocket webhook authentication
- Resend provider throttling/idempotency

Deployment/platform-enforced and still requiring manual configuration:
- durable/shared rate limits or WAF/edge controls for checkout, payment initialization, promotion validation, auth recovery, admin operational endpoints, and webhook abuse where provider protection is insufficient.

Do not use an in-memory process-local limiter as the production solution.

## 10. Deterministic smoke test

1. Open storefront.
2. Browse category.
3. Search product.
4. Open product.
5. Add product to cart.
6. Login/register.
7. Add/verify address.
8. Apply valid promotion.
9. Verify server-authoritative totals.
10. Create checkout order.
11. Initialize Razorpay.
12. Verify payment.
13. Confirm order becomes paid.
14. Confirm inventory finalization.
15. Confirm fulfillment creation.
16. Exercise Shiprocket/manual fulfillment as applicable.
17. Verify tracking.
18. Verify notification event.
19. Verify Resend delivery if configured.
20. Verify account order history.
21. Verify admin order visibility.
22. Verify analytics reflect the transaction.

Never substitute a fake payment/shipment/email success for provider verification.

## 11. Failure/recovery tests

Run controlled tests for:
- duplicate checkout request
- duplicate payment callback/webhook
- stale Razorpay worker
- payment failure/retry
- captured payment with inventory issue
- duplicate Shiprocket creation
- Shiprocket timeout/reconciliation
- duplicate Shiprocket webhook
- notification worker failure
- duplicate notification event
- invalid/expired/exhausted promotion
- per-customer promotion limit
- unauthorized admin access
- cross-user order access

Expected result: no duplicate commerce state and a recoverable authoritative state.

## 12. Backup and rollback

Before launch verify in the actual Supabase project:
- backups/PITR enabled
- migration version history recorded
- recovery project procedure tested/documented
- provider state reconciliation procedure assigned

Application rollback:
1. Stop traffic/promotion of the affected deploy.
2. Roll Netlify to the last known-good application deploy.
3. Do not automatically roll database migrations backward.
4. Preserve provider event IDs and logs.
5. Reconcile payment/shipping state before restoring traffic.

## 13. Post-launch monitoring

Monitor:
- checkout failures
- payment verification failures
- webhook failures
- `paid_inventory_issue`
- inventory exceptions
- shipment creation/reconciliation failures
- notification failures/retries
- database errors
- elevated 4xx/5xx rates
- authentication failures
- promotion validation failures

Never log API keys, service-role credentials, authorization headers, provider passwords or payment signatures.

## 14. Final manual launch checklist

- [ ] Production Supabase project selected
- [ ] Supabase migrations applied in exact order
- [ ] RLS and function privileges verified
- [ ] Auth Site URL/redirect URLs configured
- [ ] Supabase backups/PITR verified
- [ ] Netlify production site/branch verified
- [ ] All production environment variables configured
- [ ] `npm run build` succeeds in deployment environment
- [ ] `https://nuvicart.com` DNS/TLS verified
- [ ] Razorpay production/test configuration verified
- [ ] `/api/payments/webhook` registered
- [ ] Shiprocket production configuration verified
- [ ] `/api/shipping/shiprocket/webhook` registered
- [ ] Resend sending domain verified
- [ ] Durable edge/platform abuse controls configured
- [ ] End-to-end smoke test completed
- [ ] Failure/recovery tests completed
- [ ] Rollback owner assigned
- [ ] Production status explicitly recorded as CODE-READY, DEPLOYMENT-CONFIGURED, or LIVE / PROVIDER-VERIFIED
