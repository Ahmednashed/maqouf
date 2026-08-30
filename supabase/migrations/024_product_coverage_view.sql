-- ─────────────────────────────────────────────────────────────────────────────
-- 024 — Per-product assortment coverage, aggregated in the database
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Removes the last unbounded read feeding the dashboard attention panel.
-- See docs/PERFORMANCE-RISKS.md §3 and §6.
--
-- WHAT THIS REPLACES
-- ──────────────────
-- fetchProductCoverage() reads EVERY place_products row the caller can see:
--
--     .from("place_products").select("product_id, is_mandatory, is_active")
--
-- No filter, no limit, and — worth stating plainly — NO ORDERING. If PostgREST
-- is ever configured with a db-max-rows ceiling, that read truncates silently
-- and drops an arbitrary subset, producing coverage counts that are wrong with
-- no error anywhere. This view removes that exposure by aggregating in Postgres
-- and returning one row per product.
--
-- Batch 15 (migration 022) already moved the branch-side roll-up into
-- v_branch_operations. After this one, every input to the attention panel is
-- bounded by branch, product or template count — none by assortment size.
--
-- SEMANTICS PRESERVED EXACTLY
-- ───────────────────────────
-- The counts reproduce what fetchProductCoverage computes today, including one
-- inconsistency that is deliberate rather than accidental:
--
--   • ONLY is_active assortment rows are counted. A product parked on a branch
--     is not being tracked there. Note this DIFFERS from v_branch_operations,
--     whose product_count deliberately counts all rows to match what the branch
--     register showed before 022. The two views disagree on purpose; fixing
--     that is a product decision, not a refactor, and is still open.
--
--   • required_count counts active rows that are also is_mandatory.
--
--   • Products are NOT filtered by products.is_active here. deriveAttention()
--     applies that filter itself, and the products screen renders a coverage
--     cell for inactive products too. Filtering in the view would silently
--     change both.
--
-- THE ORPHAN TRAP, AND WHY THIS IS A LEFT JOIN
-- ────────────────────────────────────────────
-- Coverage keyed off place_products has no entry at all for a product that no
-- branch carries — so scanning the map to find orphans finds every orphan
-- except the ones that are actually orphaned. Batch 6 made exactly that mistake
-- and reported zero orphans.
--
-- Joining FROM products means every product gets a row, and an orphan is an
-- honest branch_count = 0 rather than an absence. This is the same shape choice
-- 022 made for never-visited branches.
--
-- The only difference from the current in-memory map is that products with no
-- active assortment row now HAVE an entry, holding zeros, where before they had
-- none. Both consumers already read through `coverage[id]?.field ?? 0`:
--   • deriveAttention() iterates products and looks each one up
--   • CoverageCell renders `coverage?.branch_count ?? 0`, then treats 0 as
--     "no branches" — identical output for undefined and for zero
--
-- SECURITY
-- ────────
-- security_invoker = true, so base-table RLS is evaluated as the querying user.
-- products_select and place_products_select are both company-scoped, so the
-- view is tenant-safe. Without this the view would run as its owner, for whom
-- RLS is not enforced — the bug migration 021 exists to fix.
--
-- NO NEW INDEX
-- ────────────
-- idx_place_products_product on place_products (product_id), added in 002,
-- already serves the join. Unlike 022 this migration adds no index and takes no
-- write-blocking lock.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace view public.v_product_coverage
with (security_invoker = true)
as
select
  p.id         as product_id,
  p.company_id as company_id,
  (count(pp.product_id) filter (where pp.is_active))::int                        as branch_count,
  (count(pp.product_id) filter (where pp.is_active and pp.is_mandatory))::int    as required_count
from public.products p
left join public.place_products pp on pp.product_id = p.id
group by p.id, p.company_id;

comment on view public.v_product_coverage is
  'Per-product assortment coverage: how many branches carry the product (active rows only), and how many mark it mandatory. security_invoker=true, so base-table RLS is evaluated as the querying user. LEFT JOIN from products on purpose — a product no branch carries returns branch_count 0 rather than being absent, so orphan detection cannot silently miss the orphans. Counts only is_active rows, matching fetchProductCoverage and deliberately differing from v_branch_operations.product_count.';

-- Parity with 023. Supabase default privileges already grant these at CREATE
-- time; stating them explicitly makes the requirement legible rather than
-- inherited, and re-granting is harmless.
grant select on public.v_product_coverage to anon;
grant select on public.v_product_coverage to authenticated;

-- PostgREST caches the schema. Without this the view is reachable in SQL but
-- answers PGRST205 over REST — which looks identical to "does not exist".
notify pgrst, 'reload schema';
