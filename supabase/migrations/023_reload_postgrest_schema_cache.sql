-- ─────────────────────────────────────────────────────────────────────────────
-- 023 — Tell PostgREST about v_branch_operations
-- ─────────────────────────────────────────────────────────────────────────────
--
-- 022 created the view successfully — it is queryable in the SQL editor and
-- pg_class confirms security_invoker=true. But the REST API returned:
--
--   404  {"code":"PGRST205",
--         "message":"Could not find the table 'public.v_branch_operations'
--                    in the schema cache"}
--
-- PostgREST serves from a cached copy of the schema and had not picked up the
-- new view. This is NOT a privilege problem: v_untouched_generated_visits
-- (migration 021) answers 200 for the same anon key, so views in this project
-- are already reachable by anon/authenticated without an explicit grant. Only
-- the cache was stale.
--
-- NOTIFY is transactional — it fires when this migration commits — and is
-- harmless to repeat. It is recorded as a migration so that a fresh
-- environment applying 001..023 ends up with a usable API, rather than a view
-- that exists in Postgres and 404s over REST until somebody notices.
--
-- If the API still 404s a few seconds after this runs, the same statement can
-- be issued by hand from the SQL editor, or the cache can be reloaded from
-- Dashboard → Settings → API.
-- ─────────────────────────────────────────────────────────────────────────────

notify pgrst, 'reload schema';

-- UPDATE, after the reload alone did not clear the 404.
--
-- PostgREST builds its schema cache from what the API roles can actually
-- SELECT, and reports PGRST205 — "not found in the schema cache" — for an
-- object they cannot see. A missing privilege and a missing relation are
-- therefore indistinguishable over REST: both are 404.
--
-- That makes the earlier reasoning wrong. v_untouched_generated_visits
-- answering 200 for the same key showed that THAT view has the grant, not
-- that every new view inherits one: Supabase default privileges are tied to
-- the role that creates the object, so a view created through a different
-- path can land without them.
--
-- Granting explicitly is idempotent, costs nothing, and removes the ambiguity
-- rather than relying on a default that demonstrably did not apply here. RLS
-- still does the actual filtering: the view is security_invoker, so SELECT
-- permission only gets a caller as far as their own company rows.

grant select on public.v_branch_operations to authenticated;

-- Reload again, so the grant is picked up in the same step.
notify pgrst, 'reload schema';
