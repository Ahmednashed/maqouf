-- ─────────────────────────────────────────────────────────────────────────────
-- 022 — Branch operational summary as a database aggregate
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Replaces the read half of fetchPlaceOperations() (src/services/places.ts),
-- which today fetches EVERY visit row the caller can see and reduces them in
-- the browser to answer one question per branch: when was it last actually
-- visited. See docs/PERFORMANCE-RISKS.md §1.
--
-- Additive only. Nothing reads this view yet — the app services are switched in
-- a separate change, after this migration has been applied and verified. The
-- view is inert until then, so applying it cannot break the running app.
--
-- ── Security ────────────────────────────────────────────────────────────────
--
-- `security_invoker = true` is mandatory here, for exactly the reason migration
-- 021 exists: a view defaults to running with its OWNER's privileges, and RLS
-- is not enforced for a table's owner, so without it any authenticated user
-- would read EVERY company's branches and visits. 021 was the fix for that
-- mistake in 020; this view is written correctly from the start.
--
-- With security_invoker the base-table policies are evaluated as the querying
-- user, which also preserves a behaviour that is easy to miss:
--
--   visits_select is ROLE-DEPENDENT — owner/admin see all company visits, a
--   merchandiser sees only visits assigned to them. So a merchandiser's "last
--   visit" already counts only their own visits, both today in the client-side
--   reduction and here. Any other approach would silently widen what
--   merchandisers see.
--
--   places_select and place_products_select are company-scoped only, not
--   role-dependent — matching the current client behaviour for those two.
--
-- get_my_company_ids(), get_my_role() and get_my_company_user_ids() are all
-- STABLE (migration 003), so the RLS predicates are evaluated once per query
-- rather than once per row.
--
-- ── Behaviour preserved, deliberately ───────────────────────────────────────
--
-- 1. "Visited" means completed or inprogress. Pending has not happened yet and
--    missed means nobody went; counting either would report a branch as
--    visited when no one set foot in it.
--
-- 2. No date arithmetic here. The view returns last_visit_date and nothing
--    else about staleness. Days-since is computed in the app against
--    riyadhToday(), because now() in SQL would depend on the database server's
--    timezone and could disagree with the Riyadh business day the rest of the
--    product reckons in.
--
-- 3. product_count counts ALL place_products rows for the branch, NOT only
--    is_active ones. That is what fetchPlaceOperations does today. Note this
--    differs from initVisitProducts() and lib/visit-plan.ts, which DO filter on
--    is_active — an existing inconsistency in the codebase. It is reproduced
--    here rather than corrected, because this migration must not change what
--    any screen displays. Fixing it is a separate, visible decision.
--
-- 4. One row per branch the caller can see, including branches with no visits
--    and no assortment (nulls and zeros). The client-side version instead
--    produced no map entry for such branches; both render identically because
--    every consumer reads through `ops[id]?.field ?? null`.
--
-- 5. Coordinates are deliberately NOT returned. Consumers already have lat/lng
--    from usePlaces(), and branchHasCoords() takes a place, not an ops row.
--    Adding them here would duplicate data the caller is already holding.
--
-- ── One intentional difference ──────────────────────────────────────────────
--
-- Ties. The client sorts only by scheduled_date, so when a branch has two
-- qualifying visits on the SAME date, which one won was whatever order
-- PostgREST happened to return — arbitrary, and potentially different between
-- two identical page loads. This view breaks ties by created_at then id, so
-- the answer is deterministic and is the most recently created of the tied
-- visits. It can therefore report a different merch_id/status than the old
-- code did for same-date ties, always from an equally valid visit.
--
-- Rollback: `drop view if exists public.v_branch_operations;` and
-- `drop index if exists public.idx_visits_place_date;`. Nothing depends on
-- either until the service swap lands.
-- ─────────────────────────────────────────────────────────────────────────────

-- Serves the LIMIT 1 lookup below: entries for one branch already ordered
-- newest-first, so the latest qualifying visit is found without scanning that
-- branch's history. Complements the existing idx_visits_place (place_id only).
--
-- Plain CREATE INDEX takes a lock that blocks writes for its duration. That is
-- instantaneous at the current row count. Against a large visits table this
-- should be CREATE INDEX CONCURRENTLY instead — which cannot run inside a
-- transaction, so it would need to be applied outside the migration runner.
create index if not exists idx_visits_place_date
  on public.visits (place_id, scheduled_date desc);

create or replace view public.v_branch_operations
with (security_invoker = true)
as
select
  p.id                                as place_id,
  p.company_id                        as company_id,
  lv.scheduled_date                   as last_visit_date,
  lv.status                           as last_visit_status,
  lv.merch_id                         as last_visit_merch,
  coalesce(pp.product_count,  0)::int as product_count,
  coalesce(pp.required_count, 0)::int as required_count
from public.places p

-- Latest real visit for this branch. LATERAL + LIMIT 1 so the planner stops at
-- the first matching index entry per branch instead of aggregating history.
left join lateral (
  select v.scheduled_date, v.status, v.merch_id
  from public.visits v
  where v.place_id = p.id
    and v.status in ('completed', 'inprogress')
  order by v.scheduled_date desc, v.created_at desc, v.id desc
  limit 1
) lv on true

-- Assortment counts. `filter (where is_mandatory)` treats NULL as false, which
-- matches the truthiness test the client uses today.
left join (
  select
    place_id,
    count(*)                            as product_count,
    count(*) filter (where is_mandatory) as required_count
  from public.place_products
  group by place_id
) pp on pp.place_id = p.id;

comment on view public.v_branch_operations is
  'Per-branch operational summary: latest completed/inprogress visit, and assortment counts. security_invoker=true, so base-table RLS is evaluated as the querying user and merchandisers still see only their own visits. Returns last_visit_date only — staleness is computed in the app against the Riyadh business day. product_count counts all place_products rows, not only active ones, matching fetchPlaceOperations.';
