# Performance risk map

Every aggregation added in Phase 2 Batches 1–13 was computed **in the browser**
from rows fetched over PostgREST. That was the right call while the database
held tens of rows and no migration was allowed. It did not stay right.

**Batch 15 moved the largest one into Postgres** (§1, §2), **Batch 18 the last
unbounded one** (§3), and **Batch 26 the dashboard fan-out** (§6). What remains
client-side is bounded by branch, product or template count, and this records
which, why that is acceptable, and what replaces each when it stops being so.

Each entry says what it reads today, why it is fine now, the specific point at
which it stops being fine, and what should replace it.

**Captured:** Batch 14. **Updated:** Batch 27, after the Batch 26 service swap.
**Deployed `main`:** `319f6125104f5b37db8698db37ca11a5bfe48ac9` — §1 and §2
resolved by migration 022, §3 by 024, §6 by 025. All three verified live in
production (022 on 2026-08-29, 024 on 2026-09-04, 025 on 2026-09-05).

---

## 0. The shape of the problem

Nothing here is slow because of an algorithm. Every reduction is a single pass
over rows already in memory. The risk is entirely in **how many rows are
fetched**.

RLS scopes each read to one company, so "the whole table" means "this company's
whole history". A company with two years of daily visits across 200 branches
has roughly 150,000 visit rows.

**Batch 15 removed the worst case** — the function that fetched every visit row
to answer a question about the most recent one per branch, on the three
most-loaded screens. **Batch 18 removed the last one**, `fetchProductCoverage`
(§3).

No read in the app is now unbounded by table size. What is left is bounded by
branch, product or template count — the small `places` reads in §4 and §5 — or
by an explicit date range, as in §5.

### A correctness risk hiding inside the performance risk

PostgREST can be configured with a `db-max-rows` ceiling. If one is set on this
project — or introduced later — an unbounded read **silently truncates** rather
than erroring.

- `fetchProductCoverage` had **no ordering at all**, so truncation would have
  dropped an arbitrary subset and produced silently wrong coverage counts.
  Migration 024 removed that exposure. **No read in the app now carries it.**
- It previously applied to `fetchBranchLastVisits` too, and more insidiously:
  ordered newest-first, truncation would have made a genuinely-visited branch
  read as **"never visited"** — wrong, and indistinguishable from the truth.
  Migration 022 removed that exposure by aggregating server-side.

This has not been observed and current row counts are far below any plausible
ceiling. It stays here because the failure mode is silent, and because it is the
reason the three aggregates were worth writing before anything got slow rather
than after.

---

## 1. `fetchBranchLastVisits` — RESOLVED (Batch 15)

**Was** the largest read in the app:

```
.from("visits").select("place_id, scheduled_date, status, merch_id")
                .order("scheduled_date", { ascending: false })
```

No date filter, no limit. It fetched every visit the company had ever had and
walked the sorted list in the browser to keep the first `completed`/
`inprogress` row per branch — on `/places`, the dashboard attention panel and
the create-visit modal, the three most-loaded screens.

**Now** reads `public.v_branch_operations` (migration 022): one row per branch,
aggregated in Postgres via `LEFT JOIN LATERAL … LIMIT 1`, served by
`idx_visits_place_date` on `visits (place_id, scheduled_date desc)`. The payload
no longer scales with visit history.

The view is `security_invoker = true`, so base-table RLS is still evaluated as
the querying user. That matters beyond tenancy: `visits_select` is
role-dependent, so a merchandiser's "last visit" counts only their own visits —
exactly as the client-side reduction did.

**Two things moved with it.** The definition of "visited" now lives in the view
body rather than a TypeScript constant, and must stay in step with
`matchesLastVisitBucket()` and the branch coverage report. And same-date ties,
previously resolved arbitrarily by whatever order PostgREST returned, are now
broken deterministically by `created_at, id`.

Riyadh staleness stays in the app: the view returns `last_visit_date` only, and
`daysSinceIso()` measures it against `riyadhToday()`, so the business day cannot
drift to the database server's clock.

**Verified in production, 2026-08-29.** The view definition is semantically
identical to the committed file — the visited-status filter, the
`created_at, id` tiebreak and the `limit 1` all intact — and
`idx_visits_place_date` exists as `(place_id, scheduled_date DESC)` and is
valid, so the payload claim above rests on a real index rather than an assumed
one. See docs/PRODUCTION-READINESS.md §10.

---

## 2. `fetchPlaceOperations` — RESOLVED (Batch 15)

**Was** `fetchBranchLastVisits()` plus an unbounded `place_products` read,
inheriting §1 entirely. **Now** one read of the same view — two queries became
one, and the assortment counts are a `GROUP BY` in Postgres.

**Still true, and deliberately so:** `product_count` counts ALL `place_products`
rows for a branch, not only `is_active` ones. That is what the client-side
version did, so the view reproduces it rather than silently moving numbers on
screen. It remains inconsistent with `initVisitProducts()` and
`lib/visit-plan.ts`, which both filter on `is_active`. Fixing that is a visible
product decision, not a refactor, and is still open.

It is still **cached and shared**: `/places`, the dashboard and the create-visit
modal use one query key, so opening the modal is usually free.

**One behavioural nuance introduced:** the view returns a row for every visible
branch, including never-visited ones (nulls and zeros), where the old reduction
produced no map entry at all. Both read identically through
`ops[id]?.field ?? null`, and the `/places` cells already treated absent and zero
the same way.

**A defect this swap exposed** (fixed in the same batch): a no-fallback service
is only half a guarantee. `/places` destructured `data: ops = {}`, so a failed
roll-up became an empty map and every branch rendered "never visited / no
assortment" — a confident claim built from data that was not there. The
dashboard gated only on `isLoading` and would publish attention counts derived
from `undefined`. Both now gate on `isSuccess`. The create-visit modal already
did this correctly since Batch 10.

---
## 3. `fetchProductCoverage` — RESOLVED (Batch 18)

**Was** the last unbounded read in the app:

```
.from("place_products").select("product_id, is_mandatory, is_active")
```

No filter, no limit, and — the part that mattered most — **no ordering**. It
read every assortment row the caller could see and reduced them in the browser,
on `/products` and on the dashboard attention panel.

**Now** reads `public.v_product_coverage` (migration 024): one row per product,
aggregated in Postgres. The payload no longer scales with assortment size.

The view is `security_invoker = true`, so `products_select` and
`place_products_select` are still evaluated as the querying user.

**The orphan trap, handled.** Coverage keyed off `place_products` has no entry
for a product no branch carries, so scanning that map for orphans finds every
orphan except the real ones — the mistake Batch 6 made. The view is a
`LEFT JOIN` **from `products`**, exactly as this section recommended before it
was written, so an orphan is an honest `branch_count = 0` rather than an
absence. That is the same shape choice 022 made for never-visited branches.

The one behavioural difference: products with no active assortment row now have
a map entry holding zeros where before they had none. Inert at both readers —
`deriveAttention()` iterates products and looks each up, and `CoverageCell`
renders `coverage?.branch_count ?? 0` and treats 0 and undefined identically.
Both paths are pinned by tests.

**Still true, and deliberately so:** this view counts **only `is_active`** rows,
matching what `fetchProductCoverage` did. `v_branch_operations.product_count`
counts **all** rows, matching what the branch register showed before 022. The
two disagree on purpose. Reconciling them moves numbers on screen and is a
product decision, not a refactor — still open.

**A defect the swap exposed** (fixed in the same batch, as Batch 15's swap did):
`/products` destructured `data: coverage = {}` with no `isSuccess` gate, so a
failed roll-up became an empty map and every product rendered the orphan badge —
asserting that nothing is stocked anywhere, on data that never arrived. It
pre-dated the swap but the swap made it more reachable, because the query now
depends on a view that must exist rather than a table that always does.
`CoverageCell` now shows an em dash with `common.dataUnavailable` until the
roll-up succeeds, matching `AssortmentCell` on `/places`.

No new index was needed: `idx_place_products_product` from migration 002 already
serves the join.
---

## 4. `fetchTeamWorkload`

`src/services/team-workload.ts` — two reads:

```
.from("visits").select("merch_id, status").eq("scheduled_date", date)
.from("places").select("assigned_user_id").eq("is_active", true)
```

| | |
|---|---|
| **Reached from** | `/users` (Batch 7 workload columns) |
| **Why acceptable now** | **Date-bounded**, and `idx_visits_scheduled_date` serves it. This is the well-behaved one |
| **Becomes risky at** | not on the visits side. The `places` read is unbounded but small |
| **Replacement** | none needed. If `/users` ever wants a date range instead of one day, revisit |

Pinned by a unit test asserting **exactly two queries, never per-member** — the
property that matters as the team grows.

---

## 5. Reports aggregations

`src/services/reports.ts` — eight table reads across the tab services.

| | |
|---|---|
| **Why acceptable now** | Every visit read is bounded by `.gte/.lte("scheduled_date", …)`, and `idx_visits_company_date` serves exactly that predicate |
| **The exception** | `fetchBranchReport` also reads **all active places** unbounded, to seed rows for branches with no visits so uncovered branches still appear. Bounded by branch count, which is small |
| **Becomes risky at** | a year-wide range over a high-volume company — the date bound stops helping when the range *is* the whole table |
| **Replacement** | server-side aggregation per tab. The five tabs are five different GROUP BYs over the same date-bounded visit set; one RPC returning all five would remove most of the payload |

The GPS tab additionally joins `place:places(lat,lng)` per visit. Fine, but it
means the GPS report's cost tracks visit count, not branch count.

---

## 6. Dashboard attention panel — RESOLVED (Batch 26)

**Was** five cached queries on the most-loaded page — every branch, every
product, every template, plus both aggregate views — reduced in the browser by
`deriveAttention()` into six integers.

**Now** one call to `public.company_attention(p_today)` (migration 025), which
returns those six integers directly.

### Why a function rather than a view

`stale` is measured against the **Riyadh** business day. A view would have to
reach for `current_date`, which is the database server's UTC day, and between
21:00 and 24:00 UTC Riyadh is already on the next calendar day — so for three
hours out of every twenty-four a view would count one day fewer than the app,
and a branch at exactly fifteen days would silently stop being stale.

Taking the day as a parameter makes the answer identical by construction. The
caller passes `riyadhToday()`, the same value `deriveAttention()` used.

**That property is not covered by any automated test**, because the tests never
reach a database. The manual check lives in
PRODUCTION-READINESS.md §8, under "The one check no test can make" — run it
after any change to 025.

### What moved, and what deliberately did not

`lib/attention.ts` was split rather than replaced. `deriveAttention()` still
computes counts from raw rows and hands them to `attentionItems(counts)`, which
the dashboard now calls directly with the RPC result. Severity, ordering and the
"a zero count produces no item" rule have one definition rather than two, and
the 34 existing attention tests still exercise it unchanged.

`usePlaces` stays. The map card counts branches without coordinates from it, so
the dashboard went from five queries to **two**, not to one. The other four are
gone from this page; each hook is still used by the screen it belongs to.

### Measured

| | Before | After |
|---|---|---|
| REST calls on `/dashboard` | 18 | **15** |
| `/dashboard` route bundle | 19.8 kB | **18.8 kB** |
| Shared First Load JS | 259 kB | **256 kB** |

The five inputs measured 2,683 bytes over seven rows on live data — at current
volume this bought nothing. Projected at 200 branches and 500 products they come
to roughly 421 KB, of which about 301 KB is removable once `places` is excluded.
The honest framing is payload at scale, not round trips today.

### Verified against three paths, not two

Before the swap, on production: the RPC, a faithful copy of the old five-query
derivation, and the counts the panel was actually rendering. All three returned
`0, 1, 1, 1, 0, 0`. The third leg is the one that matters — without it, the
comparison only proves a re-implementation agrees with itself.

---

## 7. Visit detail — plan and readiness

`src/app/(dashboard)/visits/[id]/page.tsx` uses five queries: visit, visit
products, visit responses, template, and `usePlaceProducts(place_id)`.

| | |
|---|---|
| **Why acceptable now** | Every one is scoped to a **single visit or a single branch**. This is the correctly-shaped screen |
| **Becomes risky at** | not on data volume. The risk is round-trip count on a slow mobile connection, not row count |
| **Replacement** | none needed. If the five round-trips become the bottleneck, a single RPC returning the visit bundle would help — but measure first |

`deriveVisitProductPlan`, `deriveVisitFieldPlan`, `deriveVisitReadiness` and
`diffVisitEdits` are **pure functions over already-fetched data** and add no
queries at all. They are covered by 44 + 35 + 48 + 31 unit tests respectively,
so moving the fetching underneath them is safe.

---

## 8. Priority order

| | Work | Status |
|---|---|---|
| ~~2~~ | **Last-visit-per-branch view + index** — §1, §2 | **DONE** — Batch 15, migration 022 |
| ~~3~~ | **`product_coverage` view** — §3 | **DONE** — Batch 18, migration 024 |
| ~~1~~ | **`company_attention` RPC** — §6 | **DONE** — Batch 26, migration 025 |
| 4 | **Reports RPC** — §5 | open — the only one left |

**§5 is the only performance item left.** §4 and §7 need no replacement at all
— both are already correctly shaped — so the reports aggregation is the last
thing on this list with work attached to it.

It is also the least urgent. Every visit read there is date-bounded and served
by `idx_visits_company_date`; the bound only stops helping when the requested
range approaches the whole table. And it is the largest of the three by some way
— five tabs, five different GROUP BYs — which is why it was ranked last from the
start rather than as an afterthought.

Nothing here is urgent at current volumes. The argument for writing these before
they were needed rather than after held for the first three, and holds for this
one too.

---

## 9. What Batch 15 cost, beyond the code

Worth recording, because the next view will hit the same things.

**A view is not deployed when the migration file is committed.** The SQL has to
reach the database by a separate act, and the repository cannot verify that it
did. Batch 15 shipped the app change three exchanges after the migration was
believed applied — during which the view did not actually exist in production.

**PostgREST reports `PGRST205` — "not found in the schema cache" — for a
relation the API roles cannot see, one that does not exist, and one the cache
has not picked up.** All three are 404, and they are indistinguishable from
outside. Diagnosing from the REST response alone produced two wrong answers
(stale cache, then missing grant) before the direct question — *does the
relation exist?* — settled it in one query.

**The order that works:** apply the SQL → verify with `pg_views` and
`pg_class.reloptions` → confirm the REST endpoint answers → *then* ship the code
that depends on it. Never the other way round.

**And verify afterwards, not just before.** Hand-applied SQL can diverge from
the file it came from, and nothing in the repository detects that. A read-only
drift check against `pg_catalog` settled it here in one pass, and found no
drift; it is cheap enough to repeat on every database-dependent release.

**Batch 18 followed this order, and it cost nothing.** Migration 024 was
committed first, applied by hand in the SQL Editor, verified for existence,
`security_invoker` and grants, and only then did the service swap ship. No
`PGRST205`, no wrong diagnosis, nothing to unwind — in contrast to Batch 15,
which shipped the code three exchanges before the view existed. 024 is
hand-applied like the other 24; see PRODUCTION-READINESS.md §9.
