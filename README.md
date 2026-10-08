# Nuvicart

**Everything You Love. One Cart.**

Phase 0 established the production-oriented foundation. Phase 1 added the premium storefront and local development catalog. Phase 1.1 repairs and hardens the storefront without moving production commerce concerns forward.

## Stack

- Next.js 16 App Router + React 19 + TypeScript
- Tailwind CSS 4 with CSS-variable design tokens
- Supabase Auth, PostgreSQL, Storage architecture, and RLS
- Zod validation
- Lucide React icons
- Netlify deployment target

Supabase's current Next.js guidance recommends `@supabase/ssr` for cookie-based SSR authentication and separate browser/server clients. Nuvicart follows that model.

## Architecture

- `app/` — routes, global metadata, error/not-found boundaries, sitemap and robots
- `components/ui/` — small accessible presentation primitives
- `features/` — future domain feature modules
- `lib/supabase/` — browser, server and privileged Supabase clients
- `lib/auth/` — session and server-side role enforcement
- `lib/db/` — reserved for database repositories/query modules
- `lib/validation/` — server-reusable Zod schemas
- `services/` — future payment, shipping and email provider boundaries
- `types/` — domain and generated database types
- `hooks/` — small client-side hooks
- `utils/` — framework-agnostic helpers
- `supabase/migrations/` — versioned PostgreSQL migrations

## Local development

Requirements: Node.js 20+ and npm 10+.

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open `http://localhost:3000`.

## Environment variables

| Variable | Runtime | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Browser/server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser/server | Supabase publishable/anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Privileged operations; never expose to clients |
| `NEXT_PUBLIC_SITE_URL` | Browser/server | Canonical site URL, defaults to `https://nuvicart.com` |

No credentials are included in the repository.

## Supabase setup

1. Create a Supabase project.
2. Copy the project URL and publishable/anon key into `.env.local`.
3. Run the migrations in order from `supabase/migrations/` in the Supabase SQL editor or through the Supabase CLI.
4. Configure the desired authentication providers in Supabase Auth.
5. Add the service-role key only to a server/Netlify environment when a genuinely privileged operation requires it.

The migrations create `profiles`, `roles`, the `customer/admin/super_admin` role enum, timestamps, indexes, an auth-user profile trigger, RLS policies, and a database trigger that blocks role changes from normal authenticated clients. Profiles are readable/updatable only by their owning authenticated user through the normal client. Privileged role changes must be performed by trusted server-side operations using the service-role context. The role-change hardening is isolated in `202610070002_harden_profile_role_updates.sql` so an already-applied base migration can be upgraded safely.

## Authentication architecture

`lib/supabase/client.ts` is for Client Components. `lib/supabase/server.ts` is for Server Components, Server Actions and Route Handlers. `proxy.ts` refreshes the Supabase cookie session using `auth.getUser()` when Supabase is configured.

Phase 1.1 already includes login, registration, password-reset requests, logout, Supabase SSR authentication and authenticated account routes. Phase 3 now includes persisted addresses, authenticated wishlist/cart persistence, profile editing and coordinated guest synchronization. Phase 4A adds the order history and payment-free checkout foundation described below.

## Role architecture

Application roles are represented as a PostgreSQL enum and mirrored by the TypeScript `AppRole` type. `lib/auth/roles.ts` reads the authenticated user's server-side profile and exposes `requireRole()` for server enforcement. Frontend role visibility must never be treated as authorization.

## Design system

The foundation uses semantic CSS variables for light and dark themes: surfaces, foregrounds, primary/secondary accents, borders, focus ring, success, warning, error, radii and shadows. The UI intentionally avoids heavy gradients, excessive glassmorphism and excessive motion.

Foundational primitives currently include Button, Input, Textarea, Select, Checkbox, Radio, Badge, Card, Dialog, Dropdown, Toast, Skeleton, Spinner, FormField and Container.

## Security model

- Never trust client-side roles, prices or order state.
- Validate user input on the server with Zod schemas.
- Keep service-role credentials server-only.
- Use Supabase RLS as a database security boundary.
- Use `auth.getUser()` on the server when an authenticated identity is required.
- Keep privileged mutations behind server-side authorization.
- Profile role changes are blocked for normal authenticated clients at the database trigger layer; trusted service-role operations are required to change roles.

## SEO

Global metadata, canonical metadata, Open Graph defaults, `robots.txt`, and `sitemap.xml` are wired into the App Router. Product/category metadata will become dynamic in later phases.

## Netlify deployment

`netlify.toml` uses `npm run build` and the Next.js Netlify plugin. Configure the four environment variables in the Netlify site settings. Do not commit `.env.local` or service-role credentials.

## Verification

The repository is intended to use the following reproducible gate:

```bash
npm ci
npm run typecheck
npm run lint
npm run test
npm run build
npm run check
```

`npm run check` runs TypeScript, ESLint, the Node smoke tests and the production build in sequence. In this execution environment the npm registry is not DNS-resolvable, so dependency installation and the package-lock generation step could not be completed or truthfully reported as passed.

## Phase 2 — Production catalog + commerce data foundation

Phase 2 moves the storefront catalog from demo-only data to a production-oriented Supabase/PostgreSQL model without redesigning the Phase 1 UI.

### Production catalog schema

Migration `supabase/migrations/202610070004_production_catalog.sql` evolves the existing Phase 1 `categories`, `brands` and `products` tables in place and adds:

- `categories`: active state, sort order and `updated_at`
- `brands`: description, logo, active state and `updated_at`
- `products`: SKU, short description, compare-at price, lifecycle status, featured flag and production constraints
- `product_images`: ordered primary/gallery images
- `product_variants`: stable SKU, JSONB option values and optional price overrides
- `inventory`: server-side stock and reserved quantities with non-negative constraints
- a server-side availability function that exposes availability/available quantity without exposing the inventory table to client roles

Existing product IDs remain intact so the Phase 1 wishlist foreign key remains compatible. The old Phase 1 `original_price`, `stock`, `image_url` and `secondary_image_url` columns remain for migration compatibility; Phase 2 repository reads use the production fields/tables instead. Production price authority is `products.price`, `products.compare_at_price`, and `product_variants.price_override`. The legacy `products.original_price` and `products.stock` fields are retained only for migration compatibility and are not authoritative.

### Repository architecture

The storefront uses:

```text
UI / Server Route
      ↓
Catalog Service
      ↓
Catalog Repository
   ↙          ↘
Demo         Supabase
Repository   Repository
```

`features/catalog/service.ts` selects the Supabase repository whenever public Supabase configuration exists. If Supabase is not configured in local development, it explicitly falls back to the deterministic demo repository. A configured-but-empty catalog returns an empty result, and a configured database failure is surfaced rather than silently replaced with demo data.

Client Components do not import the Supabase repository, privileged Supabase clients or the catalog service. Live search suggestions and local-wishlist product hydration use server API routes.

Production search is PostgreSQL-backed through `search_catalog_product_ids(text)`. It performs case-insensitive matching across product name, short description, description, tags, brand name and category name. User input is passed as a function parameter rather than interpolated into SQL. Existing category, brand, price, rating, stock and discount filters remain applied by the catalog repository.

The production catalog domain exposes `getCatalogProduct(slug)` for the richer product-detail model containing category, brand, images, active variants and availability. `getProduct(slug)` remains the simplified storefront DTO for existing ProductCard/ProductGrid compatibility.

### RLS and authority

Public catalog reads are limited by RLS to active categories, brands, products, product images and active variants. Catalog writes and all direct inventory access are revoked from `anon` and `authenticated`. Inventory availability is returned through a restricted security-definer function that does not expose the inventory table itself.

The browser/local cart remains a convenience snapshot only. Product price, variant price and inventory are not authoritative in localStorage. Future checkout must re-fetch and validate these values server-side.

### Development seed

After applying migrations, seed a development Supabase project with:

```bash
supabase db reset
```

or run `supabase/seed.sql` after the migrations in a non-production project. The seed uses deterministic fictional Nuvicart brands/products, stable SKUs, production images, variants and inventory records.

### Phase 2 deferred

Phase 2 did not implement checkout, orders, payment processing, shipping, refunds, production email, or admin operations. Phase 4A now implements the order/checkout foundation without payment collection. Razorpay, Shiprocket and Resend remain deferred to later phases.

## Phase 3 — Customer persistence

Phase 3 adds authenticated customer persistence without changing the Phase 1 storefront design.

- Customer profile data remains owned by `auth.users` identity and protected `profiles` fields.
- `customer_addresses` stores customer-owned addresses with database-level ownership RLS and one-default enforcement.
- The existing wishlist becomes database-backed for authenticated users while guest localStorage behavior remains available.
- `carts` and `cart_items` provide authenticated persistent cart state with product/variant references rather than authoritative price snapshots.
- Guest cart and wishlist state is merged into the authenticated account after login; stale catalog entries are safely ignored.
- One coordinated customer synchronization owner merges cart and wishlist together and updates both stores from the same authoritative response.
- Synchronization is user-scoped and marked by a deterministic guest snapshot token so accidental retries do not repeatedly add the same guest state.
- Existing authenticated cart/wishlist state is preserved; cart items merge by `product_id + variant_id` and wishlist items deduplicate by authoritative product identity.
- Logout clears private authenticated state from anonymous local storage, and user-switch markers are invalidated.
- Cart integrity is enforced in the database: products with active variants require a valid active variant; cross-product and inactive-variant references are rejected.
- Profile email is sourced from Supabase Auth and displayed read-only; only supported profile fields are writable.
- Browser-provided user IDs are never trusted for authorization; server operations derive identity from Supabase Auth.
- Checkout, orders, payments, fulfillment, shipping, refunds, communications, and admin operations remain deferred.


## Phase 4A.2 — Order Transaction Consistency

Phase 4A.2 hardens the existing order transaction so the final order total and historical order-item snapshots originate from the same authoritative catalog read.

- Each cart line is authoritatively reloaded once during final checkout validation. Product/variant identity, names, SKUs, price, quantity, and line subtotal are captured into a transaction-local JSONB snapshot.
- The captured line snapshots are used for subtotal, grand total, and `order_items`; no second catalog-price lookup is performed while creating order items. Checkout preview remains non-authoritative.
- No additional product/variant/inventory row locks were introduced. The captured snapshot is sufficient for internal order consistency, while avoiding unnecessary long-lived catalog locks and potential cross-cart deadlocks.
- Inventory is still validated only. Phase 4A.2 does not decrement, reserve, or hold inventory.
- Address snapshots, money invariants, state/payment consistency, user-scoped idempotency, RLS, and atomic cart clearing from Phase 4A.1 remain unchanged.
- Payment collection remains disabled. Razorpay, payment verification/signatures/webhooks, Shiprocket, Resend, refunds, shipping labels, and admin order mutation remain deferred to Phase 4B or later.

## Phase 4A.1 — Order Engine Hardening

Phase 4A.1 hardens the existing order/checkout foundation without introducing a payment or fulfillment integration.

- The single authenticated saved address selected at checkout is snapshotted into both `billing_address_snapshot` and `shipping_address_snapshot`; no arbitrary browser-supplied address data is accepted.
- Monetary values remain `NUMERIC(12,2)` with database invariants for non-negative amounts, `discount_total <= subtotal`, and `grand_total = subtotal - discount_total + shipping_total + tax_total`. Phase 4A.1 keeps discount, shipping, and tax at zero.
- Order and payment state transitions remain explicit and now reject impossible combinations such as paid fulfillment with non-paid payment status or refunded payment on an active order.
- Idempotency remains unique per authenticated user; retries with the same user/key return the original order, while different authenticated users may reuse the same key independently.
- Final checkout always reloads the authoritative catalog, variant, price, availability, and saved address and recalculates all totals. Preview values are never trusted.
- Order creation, item snapshotting, and cart clearing remain one database transaction with cart locking. Phase 4A.1 still validates inventory but does not decrement or reserve it.
- Customer order history remains read-only and uses persisted order/item/address snapshots rather than current catalog data.
- Payment collection remains disabled. Razorpay/payment verification, shipping, email, webhooks, refunds, and admin order mutation are explicitly deferred to future phases.

## Phase 4A — Order engine + checkout foundation

Phase 4A introduces a production-oriented order foundation without connecting a payment gateway. The flow is:

```text
Authenticated cart
      ↓
Server checkout validation
      ↓
Authoritative catalog + address + availability
      ↓
Atomic PostgreSQL order transaction
      ↓
Order + immutable item/address snapshots
```

### Order state machine

Order status and payment status are intentionally separate. Initial order states are `pending_payment`, `paid`, `processing`, `shipped`, `delivered`, `cancelled`, and `refunded`; payment states are `pending`, `paid`, `failed`, and `refunded`. Valid state transitions are enforced by a database trigger rather than accepted from the browser.

Phase 4A creates orders in `pending_payment` / `pending`. No payment is claimed or verified.

### Authoritative checkout

The client submits only the selected saved `addressId` and a per-attempt `idempotencyKey`. The server/database derives the authenticated user, reads the authenticated cart, re-fetches active products/variants, applies authoritative variant prices and inventory availability, validates the saved address ownership, and calculates totals.

All Phase 4A monetary values are stored as `NUMERIC` in `INR`. The current deterministic policy is:

- `discount_total = 0`
- `shipping_total = 0`
- `tax_total = 0`
- `grand_total = subtotal`

These are placeholders for the future commerce pricing engine, not simulated tax or shipping estimates.

### Snapshots and idempotency

Order items snapshot product name, SKU, variant name/SKU, unit price and quantity. The selected customer address is snapshotted into the order. Later catalog/address changes therefore do not rewrite historical orders.

`orders(user_id, idempotency_key)` is unique. Retrying the same checkout key returns the existing order instead of creating a duplicate. Order creation and cart clearing occur in one PostgreSQL transaction; a failed transaction does not clear the cart.

### Inventory strategy

Phase 4A validates current available quantity (`stock_quantity - reserved_quantity`) but does not permanently decrement or reserve inventory for unpaid orders. A transactional reservation/decrement strategy is deferred to the future payment/order-state phase.

### Account and checkout UI

Authenticated customers can review a server-calculated checkout, select one of their saved addresses, create an order, and view read-only order history at `/account/orders` and `/account/orders/[orderNumber]`. After successful order creation the UI explicitly states that no payment was collected and that payment will be connected in the next phase.

Phase 4A does not implement Razorpay, payment verification, webhooks, Shiprocket, Resend, refunds, admin order mutation, or fulfillment.

## Roadmap

- Phase 0 — Foundation
- Phase 1 — Storefront
- Phase 1.1 — Repair and hardening
- Phase 2 — Production catalog + commerce data foundation
- Phase 2.2 — Final repository hygiene
- Phase 3 — Customer persistence
- Phase 4A — Order engine + checkout foundation (IN PROGRESS)
- Phase 4B — Payment gateway integration
- Phase 5 — Fulfillment + communications
- Phase 6 — Admin/operations
- Phase 7 — Hardening and scale

## Phase 4B — Razorpay Payment Integration

Phase 4B adds a server-authoritative Razorpay Test Mode payment lifecycle on top of the existing Phase 4A order engine. The implementation uses Razorpay's Orders API and Standard Web Checkout; Nuvicart never collects card credentials itself.

### Payment architecture

1. The authenticated customer creates/reuses the existing `pending_payment` Nuvicart order.
2. The server prepares a persisted `payment_attempts` row and reads the persisted Nuvicart `grand_total`.
3. The server converts INR rupees to the Razorpay smallest unit and creates a Razorpay Order using server credentials.
4. The provider order ID is persisted and uniquely linked to exactly one Nuvicart order.
5. The browser opens Razorpay Checkout using only the public Key ID and provider order ID.
6. Callback data is sent to `/api/payments/verify`; the server verifies the HMAC signature, fetches the provider payment, checks order linkage, amount, currency and captured state, then finalizes payment transactionally.
7. Razorpay webhooks use the raw request body and `x-razorpay-signature` for HMAC validation. `x-razorpay-event-id` is persisted for idempotent deduplication.
8. Callback and webhook paths converge on the same database finalization function, which locks the order and inventory rows and makes repeated notifications safe.

### Payment state and retry

`payment_attempts.status` records provider lifecycle states: `created`, `pending`, `authorized`, `captured`, `failed`, `cancelled`, and `refunded`.

A failed payment keeps the order in `pending_payment` and can be retried without creating another Nuvicart order. The persisted order total remains authoritative for every retry.

### Inventory interaction

Phase 4A does not decrement inventory when an unpaid order is created. Phase 4B decrements inventory only while finalizing a verified captured payment, using row locks and an availability check in the same transaction. A duplicate callback/webhook cannot deduct inventory twice.

If Razorpay confirms a payment but inventory cannot be finalized, Nuvicart records the explicit `paid_inventory_issue` payment state instead of pretending the order was normally fulfilled or inventing a refund workflow. This requires operational resolution before fulfillment.

### Security and RLS

Customers may read their own payment attempts, but cannot insert, update or delete payment records. Webhook events and payment state transitions are server-controlled. Razorpay Key Secret and Webhook Secret are never exposed to browser code.

### Environment variables

```text
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
```

Use Razorpay Test Mode credentials for development. Live credentials are not included in this repository. Production use requires the appropriate legally valid merchant/business/payment setup and Razorpay onboarding/KYC requirements.

### Webhook endpoint

Configure the Razorpay webhook to send events to:

```text
POST /api/payments/webhook
```

The webhook secret configured in Razorpay must match `RAZORPAY_WEBHOOK_SECRET`. Invalid signatures are rejected.

### Testing status

The repository contains deterministic unit/static tests for payment security, signature verification wiring, server-side amount authority, webhook idempotency, callback/webhook convergence, retry behavior and inventory finalization. Actual Razorpay payment execution was not performed because no Test Mode credentials were supplied.

## Phase 4B.1 — Razorpay Reliability Hardening

Phase 4B.1 hardens the existing Razorpay payment implementation in place. It does not redesign payment architecture or add duplicate payment, order, checkout, webhook, shipping, refund, email, or admin systems.

### Webhook retry and concurrency

- Every webhook still requires the raw-body Razorpay signature and provider event ID.
- A verified event is persisted before processing.
- A previously processed event is acknowledged without reprocessing.
- An unprocessed event remains retryable; processing failure clears only its temporary processing claim and leaves `processed_at` NULL.
- Concurrent deliveries of the same event serialize through a row lock and a short-lived processing claim. A second live worker receives a retryable acknowledgement rather than applying the event twice.
- A stale processing claim can be recovered after five minutes, so a crashed worker cannot permanently strand an event.
- The event is marked `processed_at` only after the payment-side work succeeds.

### Payment-attempt state machine

`payment_attempts.status` is now protected by a database trigger. The legitimate forward lifecycle is:

```text
created → pending → authorized → captured → refunded
   │          │           │
   ├──────────┴───────────┴──→ failed
   └─────────────────────────→ cancelled
```

A captured payment cannot regress to `failed`, `cancelled`, or `pending`; a refunded payment cannot become captured; and a failed/cancelled attempt is not overwritten as a later successful attempt.

### Callback and failure-event races

Callback success and webhook failure do not depend on HTTP arrival order. Payment attempts are row-locked during state changes, and a failure webhook re-fetches the authoritative Razorpay payment before applying failure state. If Razorpay already reports the payment as captured, the failure event is ignored rather than regressing the successful payment.

### Inventory exception

`paid_inventory_issue` is a first-class payment exception. It means the payment was successfully verified/captured but inventory could not be finalized automatically. The order intentionally remains `pending_payment` for operational fulfillment review. It is not displayed as payment pending or payment failed, and the customer is not promised an automatic refund.

Repeated inventory-exception handling is idempotent. It does not create another payment record or decrement inventory again. Inventory deduction remains transactional and protected by `SELECT ... FOR UPDATE` locks in the existing Phase 4B finalization function.

### Retry-payment restrictions

Retry is available only for a genuinely unpaid `pending_payment` order. A failed order may be reopened to `pending` and receive a new payment attempt without creating another Nuvicart order. `paid`, `paid_inventory_issue`, `processing`, `shipped`, `delivered`, `refunded`, and `cancelled` orders cannot be retried.

### Scope

Phase 4B.1 is a payment reliability hardening pass only. It does **not** implement refunds, shipping, Shiprocket, Resend/email, admin operations, or unrelated Phase 5 functionality.

## Phase 4B.2 — Razorpay Webhook Recovery Hardening

Phase 4B.2 is a small final reliability pass over the existing Phase 4B.1
webhook architecture. It does not redesign payments or introduce duplicate
payment, webhook, order, checkout, shipping, refund, email, admin, or fulfillment
systems.

### Webhook claim lifecycle

A verified Razorpay webhook event follows:

```text
received
   ↓
persist event (first payload wins)
   ↓
claim
   ├── processed → acknowledge without reprocessing
   ├── active claim → return retryable non-2xx
   └── stale claim → reclaim with a new processing token
                         ↓
                     process event
                         ↓
                 complete with token
```

The stale-claim threshold remains exactly **5 minutes** and is centralized
inside the database claim function. It is not user-configurable.

An active `in_progress` event is **not** acknowledged with HTTP 2xx. The
webhook endpoint returns HTTP `503`, preserving a retryable failure signal so
an event cannot be permanently acknowledged while its current worker may
subsequently crash.

### Processing-token safety

A reclaimed event receives a new `processing_token`. Completion and release
require the currently stored token, so a worker holding an older token cannot
complete or release an event after another worker has reclaimed it.

The old claim is therefore invalidated transactionally by replacing the token
under the event row lock.

### Duplicate payload handling

The first verified payload stored for a `(provider, provider_event_id)` pair
remains authoritative. Duplicate delivery uses `ON CONFLICT DO NOTHING`; a
later payload with the same provider event ID cannot overwrite the original
payload or create a second event row.

### Signature and payment convergence

Raw-body Razorpay signature verification remains mandatory. Callback and
webhook payment finalization continue to use the existing idempotent payment
state machine, captured-payment protection, and transactional inventory
deduction.

### Package-lock status

Phase 4B.2 checks for `package-lock.json` and does not change dependency
versions merely to manufacture a lockfile. If npm registry access permits a
safe install using the declared dependency ranges, a lockfile may be generated
and `npm ci` verified. If registry access is unavailable, that limitation is
reported rather than claiming `npm ci` passed.

### Scope

Phase 4B.2 does **not** implement Shiprocket, Resend/email, refunds, admin
operations, fulfillment, inventory reservation, or unrelated Phase 5
functionality.


## Phase 5A — Fulfillment Engine + Shipping Foundation

Phase 5A adds Nuvicart's internal fulfillment layer between a paid order and delivery. Fulfillment is separate from payment and remains the database source of truth for fulfillment state.

- Fulfillment states: `pending` → `processing` → `ready_to_ship` → `shipped` → `delivered`; `pending` may be cancelled. Invalid transitions are blocked at the database layer.
- Only orders with `status = paid` and `payment_status = paid` can enter normal fulfillment. `paid_inventory_issue` is explicitly excluded until resolved; no fake resolution is implemented.
- Inventory is already finalized by Phase 4B payment finalization. Fulfillment never decrements, reserves, or moves inventory.
- Fulfillment snapshots the order's historical `shipping_address_snapshot`; later customer address edits do not change it.
- `ShippingProvider` is the application boundary. Phase 5A supplies only a manual provider; there is no Shiprocket API integration.
- A protected server operation supports manual shipment assignment with carrier, tracking number, and shipping method. Customers have read-only access to their own fulfillment/tracking data.
- Fulfillment events provide a lightweight state history.
- Tracking data is only displayed when persisted; no carrier scraping or fabricated tracking links/statuses are used.
- Refunds, Shiprocket, Resend, and a full admin dashboard are deferred to later phases.

## Phase 5B — Shiprocket Shipping Integration

Phase 5B adds Shiprocket as the first real external shipping provider behind the existing `ShippingProvider` abstraction. The internal Nuvicart fulfillment database remains authoritative; Shiprocket is a provider, not the fulfillment state machine.

### Shiprocket configuration

Server-only variables:

- `SHIPROCKET_EMAIL`
- `SHIPROCKET_PASSWORD`
- `SHIPROCKET_BASE_URL`
- `SHIPROCKET_WEBHOOK_SECRET`
- `SHIPROCKET_PICKUP_LOCATION`
- package weight/dimensions used when the internal catalog has no package measurements

Never expose these through `NEXT_PUBLIC_*` variables or client code. Production credentials belong in the deployment environment.

### Provider flow

`paid order → fulfillment pending → processing → ready_to_ship → Shiprocket create/update → AWB assignment → fulfillment shipped → delivered`

Inventory is not touched by shipping operations.

Shiprocket's order-create endpoint is used with the stable Nuvicart order reference. A retry therefore reuses the same provider order reference rather than creating a second Nuvicart fulfillment. A short-lived database claim token prevents concurrent shipment creation requests from running at the same time.

### Mapping

Shipment creation uses the immutable fulfillment shipping-address snapshot and historical `order_items` snapshots (`product_name`, SKU/variant SKU, quantity, and unit price). Current customer addresses and current catalog prices are never consulted for an existing order shipment.

### Authentication and failures

Shiprocket authentication is server-side and token-cached. Unauthorized responses invalidate the cache and retry authentication once. Network, timeout, rate-limit, provider-5xx, malformed-response, and validation failures are normalized without exposing credentials or authorization headers. A failed provider operation leaves the Nuvicart fulfillment in `ready_to_ship`.

### Tracking and webhooks

AWB tracking is stored on the fulfillment and is visible through the existing customer-scoped fulfillment read path. The Shiprocket webhook requires the configured `x-api-key` security token, validates the payload, deduplicates events, and maps only safe provider statuses into the Nuvicart fulfillment state machine. Out-of-order events cannot regress delivered/shipped/cancelled states.

### Manual fallback

The Phase 5A manual shipping provider remains available. Phase 5B does not automatically switch between providers because an automatic fallback could create duplicate external shipments.

### Scope exclusions

Phase 5B does not implement refunds, promotions, coupons, analytics, Resend/email integration, inventory redesign, payment redesign, split shipments, multi-warehouse support, or returns/RMA.


## Phase 5B.1 — Shiprocket External Idempotency + Recovery Hardening

Shiprocket shipment creation uses a deterministic provider operation key derived from the Nuvicart fulfillment UUID. Retries reuse the same identity. Before creating a provider order, the server reconciles Shiprocket using the merchant/reference order identity and reuses any existing provider order it finds. Provider order identifiers are persisted before AWB assignment, so an order-created/AWB-failed outcome remains recoverable.

External timeouts are treated as unknown outcomes, not confirmed failures. A retry must reconcile before creating another provider order. AWB assignment is a separate recoverable stage. Nuvicart fulfillment is marked shipped only after a confirmed AWB/shipment exists.

Stale Nuvicart workers remain protected by the existing processing token; a worker that loses the claim cannot overwrite a newer operation. Manual shipping remains available.

## Transactional email (Phase 5C)

Nuvicart transactional email uses a provider-neutral `EmailProvider` abstraction with a server-only Resend implementation and a development no-op provider. Configure `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and optional `RESEND_FROM_NAME` through deployment/server secrets in production. Never expose the Resend API key through a `NEXT_PUBLIC_*` variable or commit `.env` files.

Notification events are persisted in the durable notification outbox migration and are downstream of authoritative order, payment, and fulfillment state. Delivery retries are bounded and provider requests use deterministic event idempotency keys.


## Production readiness

Phase 8 production hardening distinguishes code readiness from deployment configuration. See `docs/production.md` for required environment variables, Supabase backup/migration procedures, Razorpay/Shiprocket/Resend webhook configuration, Netlify setup, rate-limiting requirements, and rollback guidance. The repository never contains production secrets.


## Phase 9 — Deployment Integration

Phase 9 prepares the repository for a real production deployment without introducing new commerce features. The authoritative deployment/runbook is `docs/phase-9-go-live.md`.

The repository can be **CODE-READY** after the local security and regression gates. It is **DEPLOYMENT-CONFIGURED** only after the real Supabase, Netlify, DNS, Razorpay, Shiprocket and Resend settings have been verified. It is **LIVE / PROVIDER-VERIFIED** only after an actual deployment and provider transactions/events have been observed.

No production credentials are committed to this repository.
