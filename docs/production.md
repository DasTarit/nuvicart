# Nuvicart Production Deployment & Recovery

This document distinguishes **CODE-READY** from **DEPLOYMENT-CONFIGURED**. Passing the repository test suite does not mean a production environment is live.

## Required production configuration

### Public/browser variables
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SITE_URL`

### Server-only secrets
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

Never expose server-only variables through `NEXT_PUBLIC_*`.

## Supabase

1. Configure production Supabase project and Auth.
2. Apply migrations in filename order through `202610090008_production_hardening.sql`.
3. Confirm database backups/PITR are enabled in the Supabase project.
4. Before destructive operational changes, take/verify a recoverable backup.
5. Keep the service-role key only in server-side deployment secrets.

The repository does not claim that backups are configured; deployment owners must verify this in the actual Supabase project.

## Razorpay

Configure the production key ID/secret and webhook secret in deployment secrets.

Register the production webhook endpoint:
`/api/payments/webhook`

Verify the webhook secret and production event configuration in the Razorpay dashboard. Do not place the webhook secret in source control.

## Shiprocket

Configure server-only Shiprocket credentials and webhook secret.

Register:
`/api/shipping/shiprocket/webhook`

Verify the provider account, pickup location, package defaults, and webhook configuration in the Shiprocket dashboard.

## Resend

Configure:
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `RESEND_FROM_NAME`

Verify the sending domain/from address in Resend before enabling transactional mail.

## Netlify

Configure all required environment variables in the Netlify production environment. Do not upload `.env` files.

Build command:
`npm run build`

The repository's `netlify.toml` is the source of truth for deployment-specific settings. Verify the actual Netlify site is connected to the intended repository/branch before launch.

## Domain / HTTPS

Configure the production domain and TLS certificate in Netlify/DNS. Set `NEXT_PUBLIC_SITE_URL` to the canonical HTTPS origin.

The application sends HSTS from the production build; do not serve the site over plaintext HTTP.

## Rate limiting / abuse controls

The application deliberately does not use an in-memory process-local rate limiter because Netlify/serverless deployments can be horizontally scaled.

Before launch, configure durable/shared edge or platform controls for at least:
- payment initialization
- checkout
- coupon validation
- password/auth recovery endpoints provided by the deployment
- admin search/operational endpoints
- webhook abuse protection where the provider does not already provide sufficient controls

Provider webhook signatures and server-side bounded inputs remain required application defenses. Do not treat this repository as having a universal distributed rate limiter.

## Recovery / rollback

### Application rollback
1. Stop promotion of the affected deployment.
2. Roll Netlify back to the last known-good deploy.
3. Do not roll database migrations backward automatically.
4. Preserve logs and provider event IDs for diagnosis.

### Database recovery
1. Identify the last known-good migration/application version.
2. Use Supabase backup/PITR recovery procedures if data corruption occurred.
3. Restore to an isolated recovery project first when practical.
4. Reconcile provider payment/shipping state before reconnecting production traffic.

### Secret recovery
Rotate compromised secrets at the provider first, then update Netlify secrets. Never commit replacement secrets.

## Launch checklist

- [ ] Supabase production project verified
- [ ] Backups/PITR verified
- [ ] All migrations applied in order
- [ ] RLS verified in production
- [ ] Razorpay production keys/webhook verified
- [ ] Shiprocket production credentials/webhook verified
- [ ] Resend domain/from address verified
- [ ] Netlify environment configured
- [ ] HTTPS/domain verified
- [ ] Durable rate limiting/edge abuse controls configured
- [ ] Smoke test completed with a real test transaction according to provider test/live mode
- [ ] Rollback owner and procedure confirmed

**Status terminology:** this repository can be **CODE-READY** after the Phase 8 checks. It is **DEPLOYMENT-CONFIGURED** only after the checklist above is verified against the real production providers.
