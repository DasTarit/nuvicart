# Catalog boundary

Phase 1/1.1 uses a **local development catalog** from `data.ts`.

UI components consume the service functions in `service.ts` rather than importing the demo array directly.

Future production work should replace the service implementation with a Supabase-backed repository without changing storefront component contracts. Do not treat the current demo catalog as authoritative inventory, pricing, availability, or order data.
