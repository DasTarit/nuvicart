# Supabase foundation

1. Create a Supabase project.
2. Copy its URL and publishable/anon key into `.env.local`.
3. Run migrations in filename order from `supabase/migrations/`.
4. For development, run `supabase db reset` or apply `supabase/seed.sql` after migrations in a non-production project.
5. Enable the authentication providers you intend to support.
6. Keep `SUPABASE_SERVICE_ROLE_KEY` server-only. Never expose it in client code.

Phase 2 migration `202610070004_production_catalog.sql` evolves the Phase 1 catalog tables in place and adds product images, variants, inventory, production constraints, active-state RLS, indexes and a restricted availability function.

The browser may read active catalog entities through RLS, but catalog writes and direct inventory access are not granted to `anon` or `authenticated`. The local cart remains non-authoritative; future checkout must revalidate price, variant and inventory server-side.
