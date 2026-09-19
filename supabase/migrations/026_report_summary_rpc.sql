-- ─────────────────────────────────────────────────────────────────────────────
-- 026 — report_summary: the Reports summary counts, in one call
-- ─────────────────────────────────────────────────────────────────────────────
--
-- See docs/PERFORMANCE-RISKS.md §5.
--
-- WHY THIS EXISTS
-- ───────────────
-- fetchReportSummary() (src/services/reports.ts) fetches every visit in the
-- selected range, plus every product-audit row of every completed visit in the
-- range, and counts them in the browser. The project's Data API "Max rows"
-- setting is 1,000 (read from the dashboard, unchanged). A read that would
-- return more rows than that is cut to 1,000 WITHOUT an error, and neither read
-- is ordered — so once a range holds more than 1,000 visits or audit rows, the
-- summary cards and the Excel summary sheet would show plausible, wrong totals.
-- Current volume is far below the cap; this is preventive.
--
-- This function counts inside PostgreSQL and returns a single row, so the cap
-- can never apply to it.
--
-- THIS MIGRATION DOES NOT CHANGE THE APP
-- ──────────────────────────────────────
-- Nothing calls this function yet. Applying it is safe on its own; the service
-- swap is a separate batch, made only after the function is verified in the
-- database, refused over REST for anonymous callers, and checked signed in
-- (docs/PRODUCTION-READINESS.md §8, deploy order).
--
-- WHAT IT DELIBERATELY DOES NOT DO: RATES AND AVERAGES
-- ────────────────────────────────────────────────────
-- It returns whole counts plus duration_sum and duration_count. It does NOT
-- compute completion_rate or avg_duration. The app computes those with
-- Math.round() on JavaScript doubles, and exact SQL rounding disagrees with it:
-- 23 completed of 40 finished is exactly 57.5%, but JavaScript evaluates
-- 0.575 × 100 as 57.4999… and shows 57, where SQL round() would show 58.
-- Returning counts and leaving the arithmetic in the app keeps every displayed
-- and exported number identical by construction.
--
-- SEMANTICS PRESERVED EXACTLY (fetchReportSummary as of 82c2f54)
-- ─────────────────────────────────────────────────────────────
--   • Dates: scheduled_date >= p_from AND <= p_to — inclusive both ends. The
--     caller passes the range the app already uses (built from the Riyadh
--     business day). No current_date, no now(), no timezone conversion here:
--     scheduled_date is a plain DATE and is compared as given. A reversed range
--     simply matches nothing, as the current reads do.
--   • p_merch_id / p_place_id narrow BOTH the visit counts and the product
--     figures, like the two current reads.
--   • p_status narrows the VISIT counts only. The product figures always count
--     completed visits and ignore the status filter — that is what the current
--     product read does, and it is kept, not "fixed".
--   • Durations: only completed visits with duration_minutes > 0 contribute
--     (a NULL or zero duration is skipped), matching the current reducer.
--   • Product figures: audited_products and products_with_shortfall are NULL
--     when there are no product rows at all, never 0 — the page shows "no
--     audits" for NULL, and a 0 would read as "nothing was missing". A NULL
--     qty_missing counts as not short (coalesce to 0), as `?? 0` does today.
--   • merch_id and place_id are NOT NULL on visits, so count(distinct …) and the
--     app's Set sizes agree.
--
-- SECURITY
-- ────────
-- SECURITY INVOKER, stated explicitly. Every row is read under the CALLER's RLS:
--
--   visits_select         → company-scoped AND role-dependent: a merchandiser
--                           sees only their own visits, so their summary counts
--                           only their own visits, exactly as today.
--   visit_products_select → `visit_id IN (SELECT id FROM visits WHERE …)`. That
--                           subquery is itself evaluated under visits_select, so
--                           a product row is visible only when its visit is —
--                           the merchandiser restriction already reaches
--                           visit_products through the policy.
--
-- The explicit join to public.visits in the product CTE is therefore not what
-- keeps other merchandisers' rows out. It is needed for the semantics: the
-- product figures count only rows whose visit falls in the date range, is
-- completed, and matches the merchandiser/branch filters — none of which are
-- columns of visit_products — and it mirrors the current `visit:visits!inner`
-- embed, which is an inner join for exactly the same reasons.
--
-- Every object is schema-qualified, so name resolution does not depend on the
-- search path. `set search_path = public` is kept for parity with the earlier
-- functions; for a SECURITY INVOKER function the caller could only affect their
-- own call, so it is belt-and-braces rather than a security boundary.
--
-- Grants intentionally differ from 025 (least privilege, owner-approved).
-- EXECUTE defaults to PUBLIC, which includes anon, and Supabase's default
-- privileges usually grant new functions to anon explicitly as well. The
-- Reports page always requires sign-in, and an anon caller would only ever
-- receive a row of zeros under RLS — harmless, but there is no reason to let
-- unauthenticated requests run a date-range scan. So EXECUTE is revoked from
-- PUBLIC and from anon, and granted to authenticated only.
--
-- Verification consequence: an anonymous REST call (anon key, no user JWT) is
-- expected to be REFUSED with a permission error — not to return 200 with
-- zeros, as the 022–025 reachability checks did. Results are verified signed
-- in, as an authenticated user.
--
-- INDEXES
-- ───────
-- None added. The visit reads are selected by RLS company_id plus the
-- scheduled_date range, which idx_visits_company_date (company_id,
-- scheduled_date) serves — the same index the current reads use. Product rows
-- are reached per visit through visit_products' primary key (visit_id,
-- product_id) and idx_visit_products_visit.
--
-- Known cost that this function neither adds nor removes: visit_products_select
-- checks each row against the company's visits without a date bound. The
-- current product read pays the same cost.
--
-- RETURN SHAPE
-- ────────────
-- Exactly one row, even for an empty range: two aggregate subqueries with no
-- GROUP BY each always yield one row. Over PostgREST it arrives as a
-- single-element array; the service layer will read data[0].
--
-- ROLLBACK
-- ────────
-- Nothing depends on this function until the service swap lands, so it can be
-- dropped at any time:
--   drop function if exists public.report_summary(date, date, uuid, uuid, public.visit_status);
--
-- READ-ONLY CHECKS AFTER APPLYING (SQL Editor)
-- ────────────────────────────────────────────
-- The SQL Editor runs as a superuser and BYPASSES RLS, so its numbers are not
-- the app's numbers — use it to check the definition, and REST/the signed-in
-- app to check results.
--   select p.prosecdef, p.provolatile, p.proconfig, p.proacl,
--          pg_get_function_identity_arguments(p.oid)
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'report_summary';
--   -- expect: prosecdef = false, provolatile = 's',
--   --         proconfig = {search_path=public},
--   --         proacl grants authenticated, and has no anon and no PUBLIC entry
-- Then over REST: with the anon key alone the call is refused; signed in, it
-- returns exactly one row, compared against the current summary on real data.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.report_summary(
  p_from     date,
  p_to       date,
  p_merch_id uuid                default null,
  p_place_id uuid                default null,
  p_status   public.visit_status default null
)
returns table (
  total_visits            int,
  completed               int,
  missed                  int,
  pending                 int,
  inprogress              int,
  active_merchandisers    int,
  covered_branches        int,
  scheduled_branches      int,
  duration_sum            bigint,
  duration_count          int,
  audited_products        int,
  products_with_shortfall int
)
language sql
stable
security invoker
set search_path = public
as $$
  with visit as (
    -- The summary's visit read: range, merchandiser, branch AND status.
    select v.status, v.duration_minutes, v.merch_id, v.place_id
    from public.visits v
    where v.scheduled_date >= p_from
      and v.scheduled_date <= p_to
      and (p_merch_id is null or v.merch_id = p_merch_id)
      and (p_place_id is null or v.place_id = p_place_id)
      and (p_status   is null or v.status   = p_status)
  ),
  product as (
    -- The summary's product read: ONLY through a visible completed visit, and
    -- WITHOUT the status filter — see SEMANTICS above.
    select vp.product_id, vp.qty_missing
    from public.visit_products vp
    join public.visits v on v.id = vp.visit_id
    where v.scheduled_date >= p_from
      and v.scheduled_date <= p_to
      and v.status = 'completed'
      and (p_merch_id is null or v.merch_id = p_merch_id)
      and (p_place_id is null or v.place_id = p_place_id)
  )
  select
    vs.total_visits,
    vs.completed,
    vs.missed,
    vs.pending,
    vs.inprogress,
    vs.active_merchandisers,
    vs.covered_branches,
    vs.scheduled_branches,
    vs.duration_sum,
    vs.duration_count,
    pr.audited_products,
    pr.products_with_shortfall
  from (
    select
      count(*)::int                                                  as total_visits,
      (count(*) filter (where status = 'completed'))::int            as completed,
      (count(*) filter (where status = 'missed'))::int               as missed,
      (count(*) filter (where status = 'pending'))::int              as pending,
      (count(*) filter (where status = 'inprogress'))::int           as inprogress,
      count(distinct merch_id)::int                                  as active_merchandisers,
      (count(distinct place_id) filter (where status = 'completed'))::int as covered_branches,
      count(distinct place_id)::int                                  as scheduled_branches,
      -- completed visits with a recorded duration above zero only
      coalesce(sum(duration_minutes) filter (
        where status = 'completed' and duration_minutes > 0), 0)::bigint as duration_sum,
      (count(*) filter (
        where status = 'completed' and duration_minutes > 0))::int   as duration_count
    from visit
  ) vs
  cross join (
    select
      -- NULL, not 0, when there are no audit rows at all
      case when count(*) = 0 then null
           else count(distinct product_id)::int end                 as audited_products,
      case when count(*) = 0 then null
           else (count(distinct product_id) filter (
                   where coalesce(qty_missing, 0) > 0))::int end     as products_with_shortfall
    from product
  ) pr;
$$;

comment on function public.report_summary(date, date, uuid, uuid, public.visit_status) is
  'Reports summary counts for the calling user''s company, in one row, so the Data API row cap (1,000) cannot truncate them. SECURITY INVOKER: visits and visit_products are read under the caller''s RLS (visit_products_select already limits product rows to visits the caller can see). Product figures join public.visits for the date range, completed status and merchandiser/branch filters. EXECUTE is granted to authenticated only; anonymous calls are refused. Takes the date range from the app (inclusive, no current_date). Status narrows visit counts only; product figures count completed visits and are NULL when there are no audit rows. Returns duration_sum/duration_count rather than an average, and no completion rate: the app computes those so its rounding is unchanged. See docs/PERFORMANCE-RISKS.md §5.';

-- EXECUTE defaults to PUBLIC (which includes anon). Reports require sign-in, so
-- only authenticated callers may run this; anonymous calls are refused — see
-- SECURITY above.
revoke execute on function public.report_summary(date, date, uuid, uuid, public.visit_status) from public;
revoke execute on function public.report_summary(date, date, uuid, uuid, public.visit_status) from anon;
grant  execute on function public.report_summary(date, date, uuid, uuid, public.visit_status) to authenticated;

-- PostgREST caches the schema. Without this the function exists in SQL but
-- answers PGRST202 over REST, which looks the same as "does not exist".
notify pgrst, 'reload schema';
