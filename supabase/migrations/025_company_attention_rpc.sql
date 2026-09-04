-- ─────────────────────────────────────────────────────────────────────────────
-- 025 — company_attention: the six dashboard attention counts, in one call
-- ─────────────────────────────────────────────────────────────────────────────
--
-- See docs/PERFORMANCE-RISKS.md §6.
--
-- WHY A FUNCTION AND NOT A VIEW
-- ─────────────────────────────
-- Five of the six counts are pure set arithmetic and a view would serve them
-- fine. The sixth, `stale`, is measured against the RIYADH business day.
--
-- A view would have to reach for `current_date`, which is the database server's
-- UTC day. Between 21:00 and 24:00 UTC, Riyadh (UTC+3) is already on the next
-- calendar day, so for three hours out of every twenty-four a view would compute
-- one day fewer than the application does. A branch sitting at exactly fifteen
-- days would report fourteen and drop out of the stale count — a wrong number,
-- produced silently, for 12.5% of the day.
--
-- Taking the day as a parameter removes the question entirely: the caller passes
-- `riyadhToday()`, the same value `deriveAttention()` uses today, and the answer
-- is identical by construction rather than by approximation.
--
-- SECURITY
-- ────────
-- SECURITY INVOKER, stated explicitly rather than left to the default. Every
-- table read here carries RLS, and both views are themselves security_invoker,
-- so the whole chain is evaluated as the querying user:
--
--   places / products / templates / template_fields → company-scoped policies
--   v_branch_operations (022) → visits_select, which is ROLE-dependent, so a
--     merchandiser's counts reflect only their own visits, exactly as the
--     client-side derivation does
--   v_product_coverage (024) → products_select + place_products_select
--
-- EXECUTE on a function defaults to PUBLIC in PostgreSQL, so the grants below
-- add nothing by themselves. They are written out because the requirement is
-- worth stating, and because a future migration that revokes PUBLIC should not
-- silently take the app with it. RLS, not the grant, is what keeps one company
-- from seeing another's rows.
--
-- SEMANTICS PRESERVED EXACTLY
-- ───────────────────────────
-- This reproduces lib/attention.ts. Three details are easy to "fix" by accident
-- and must not be:
--
--   1. `no_assortment` reads v_branch_operations.product_count, which counts
--      ALL place_products rows including inactive ones. `orphan_products` reads
--      v_product_coverage.branch_count, which counts ONLY active ones. The two
--      disagree on purpose — each matches the screen it was written for — and
--      reconciling them is a product decision, not a refactor.
--
--   2. `stale` EXCLUDES never-visited branches. They are already reported by
--      `never_visited`, and counting a branch twice inflates the panel rather
--      than informing it.
--
--   3. The comparison is strictly greater than 14, matching STALE_AFTER_DAYS
--      and the `gt14` bucket in the branch coverage report. `date - date` in
--      Postgres yields whole days, as daysSinceIso() does in the app, so a
--      branch at exactly 14 days is not stale in either.
--
-- Only ACTIVE places and products are considered, and only templates with
-- status = 'active'. Deactivating something is a deliberate act; nagging about
-- it would train people to ignore the panel.
--
-- RETURN SHAPE
-- ────────────
-- One row, six integers. Over PostgREST this arrives as a single-element array,
-- so the service layer will read `data[0]`.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.company_attention(p_today date)
returns table (
  never_visited   int,
  stale           int,
  no_assortment   int,
  unassigned      int,
  orphan_products int,
  empty_templates int
)
language sql
stable
security invoker
set search_path = public
as $$
  with branch as (
    select
      p.id,
      p.assigned_user_id,
      bo.last_visit_date,
      coalesce(bo.product_count, 0) as product_count
    from public.places p
    left join public.v_branch_operations bo on bo.place_id = p.id
    where p.is_active
  ),
  template_field_counts as (
    select template_id, count(*) as field_count
    from public.template_fields
    group by template_id
  )
  select
    (select count(*) from branch
      where last_visit_date is null)::int                              as never_visited,

    -- strictly greater than 14, and never-visited branches are excluded
    (select count(*) from branch
      where last_visit_date is not null
        and (p_today - last_visit_date) > 14)::int                     as stale,

    -- product_count counts ALL assortment rows, active or not — see note 1
    (select count(*) from branch
      where product_count = 0)::int                                    as no_assortment,

    (select count(*) from branch
      where assigned_user_id is null)::int                             as unassigned,

    -- branch_count counts ONLY active assortment rows — see note 1
    (select count(*)
       from public.products pr
       left join public.v_product_coverage pc on pc.product_id = pr.id
      where pr.is_active
        and coalesce(pc.branch_count, 0) = 0)::int                     as orphan_products,

    (select count(*)
       from public.templates t
       left join template_field_counts f on f.template_id = t.id
      where t.status = 'active'
        and coalesce(f.field_count, 0) = 0)::int                       as empty_templates;
$$;

comment on function public.company_attention(date) is
  'The six dashboard attention counts for the calling user''s company, in one round trip. Takes the Riyadh business day as a parameter rather than using current_date, because the database server runs on UTC and the two disagree for three hours every night — see docs/PERFORMANCE-RISKS.md §6. SECURITY INVOKER: every underlying table and view is RLS-scoped to the caller. Reproduces lib/attention.ts exactly, including the deliberate is_active mismatch between no_assortment and orphan_products.';

grant execute on function public.company_attention(date) to anon;
grant execute on function public.company_attention(date) to authenticated;

-- PostgREST caches the schema. Without this the function exists in SQL but
-- answers PGRST202 over REST, which looks the same as "does not exist".
notify pgrst, 'reload schema';
