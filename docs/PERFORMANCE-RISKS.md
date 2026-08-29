# Performance risk map

Every aggregation added in Phase 2 Batches 1–13 was computed **in the browser**
from rows fetched over PostgREST. That was the right call while the database
held tens of rows and no migration was allowed. It did not stay right.

**Batch 15 moved the largest one into Postgres** (§1, §2). The rest are still
client-side, and this records which, why that is still acceptable, and what
replaces each when it stops being so.

Each entry says what it reads today, why it is fine now, the specific point at
which it stops being fine, and what should replace it.

**Captured:** Batch 14. **Updated:** Batch 16, after the Batch 15 service swap.
**Current `main`:** `b3caf20` — §1 and §2 resolved by migration 022.

---

## 0. The shape of the problem

Nothing here is slow because of an algorithm. Every reduction is a single pass
over rows already in memory. The risk is entirely in **how many rows are
fetched**.

RLS scopes each read to one company, so "the whole table" means "this company's
whole history". A company with two years of daily visits across 200 branches
has roughly 150,000 visit rows.

**Batch 15 removed the worst case.** The one function that fetched all of those
to answer a question about the most recent row per branch — and did it on the
three most-loaded screens — is now a database aggregate. What remains unbounded
is `fetchProductCoverage` (§3), bounded by branches × assortment rather than by
history, and the small `places` reads in §4 and §5.

### A correctness risk hiding inside the performance risk

PostgREST can be configured with a `db-max-rows` ceiling. If one is set on this
project — or introduced later — an unbounded read **silently truncates** rather
than erroring.

- `fetchProductCoverage` has **no ordering at all**, so truncation would drop an
  arbitrary subset and produce silently wrong coverage counts. This is now the
  only place that risk applies.
- It previously applied to `fetchBranchLastVisits` too, and more insidiously:
  ordered newest-first, truncation would have made a genuinely-visited branch
  read as **"never visited"** — wrong, and indistinguishable from the truth.
  Migration 022 removed that exposure by aggregating server-side.

This has not been observed and current row counts are far below any plausible
ceiling. It is listed because the failure mode is silent, and because it argues
for bounding the remaining read before it becomes slow.

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
## 3. `fetchProductCoverage`

`src/services/products.ts` — `.from("place_products").select("product_id, is_mandatory, is_active")`, no filter, **no ordering**.

| | |
|---|---|
| **Reached from** | `/products` (coverage column), `/dashboard` (orphan-product attention item) |
| **Why acceptable now** | Same bound as §2, and the reduction skips inactive rows in one pass |
| **Becomes risky at** | the same 60,000-row scale |
| **Replacement** | `SELECT product_id, count(*) FILTER (WHERE is_active), count(*) FILTER (WHERE is_active AND is_mandatory) FROM place_products GROUP BY product_id` as a view. Trivial to write; only migration policy has kept it out |

**Note the orphan-product subtlety:** coverage is keyed off `place_products`, so
a product assigned to *no* branch has no entry at all. Batch 6 got this wrong
once — it scanned the coverage map and found zero orphans. The consumer must
iterate **products** and look each one up. A GROUP BY view would have the same
trap; the view should be a `LEFT JOIN` from `products` if it is ever written.

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

## 6. Dashboard attention panel

`src/app/(dashboard)/dashboard/page.tsx` fans out to **five** cached queries:
`usePlaces`, `usePlaceOperations`, `useProducts`, `useProductCoverage`,
`useTemplates`, then derives everything in `lib/attention.ts`.

| | |
|---|---|
| **Why acceptable now** | All five are shared query keys already populated by other screens, and the panel has its own loading state so the page paints first |
| **Becomes risky at** | inherits §1 and §3 — the dashboard is the **most-loaded page**, so it is where the whole-table scan hurts first |
| **Replacement** | one `company_attention` view returning the five counts. This is the single highest-value view to write |

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
| 1 | **`company_attention` view** — §6 | open — highest traffic |
| 3 | **`product_coverage` view** — §3 | open — easiest; mind the orphan `LEFT JOIN` |
| 4 | **Reports RPC** — §5 | open — largest effort, least urgent |

§6 is now the highest-value remaining item. Note it got *cheaper* as a result of
Batch 15: two of the five queries it fans out to are already answered by
`v_branch_operations`, so a `company_attention` view would extend that work
rather than start fresh.

Nothing here is urgent at current volumes. The three remaining are cheap to
write and hard to retrofit under pressure, which is the argument for writing
them before they are needed rather than after.

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
