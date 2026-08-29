# Performance risk map

Every aggregation added in Phase 2 Batches 1–13 is computed **in the browser**
from rows fetched over PostgREST. That was the right call while the database
holds tens of rows and no migration was allowed. It will not stay right.

This records what each one reads today, why it is fine now, the specific point
at which it stops being fine, and what should replace it.

**Captured:** end of Batch 14, against `main` @ `72bf61d`.
**No migrations were added by this batch.**

---

## 0. The shape of the problem

Nothing here is slow because of an algorithm. Every reduction is a single pass
over rows already in memory. The risk is entirely in **how many rows are
fetched**, and three of these functions fetch a whole table.

RLS scopes each read to one company, so "the whole table" means "this company's
whole history". A company with two years of daily visits across 200 branches
has roughly 150,000 visit rows. Four of the screens below would fetch all of
them to answer a question about the last one.

### A correctness risk hiding inside the performance risk

PostgREST can be configured with a `db-max-rows` ceiling. If one is set on this
project — or introduced later — the unbounded reads below **silently truncate**
rather than error.

- `fetchBranchLastVisits` orders by `scheduled_date DESC`, so truncation keeps
  the newest rows. A branch not visited within the returned window would then
  read as **"never visited"** — wrong, and indistinguishable from the truth.
- `fetchProductCoverage` has **no ordering at all**, so truncation would drop an
  arbitrary subset and produce silently wrong coverage counts.

This has not been observed and the current row counts are far below any
plausible ceiling. It is listed because the failure mode is silent, and because
it argues for bounding these reads even before they become slow.

---

## 1. `fetchBranchLastVisits` — the biggest one

`src/services/places.ts`

```
.from("visits").select("place_id, scheduled_date, status, merch_id")
                .order("scheduled_date", { ascending: false })
```

**No date filter. No limit.** Reads every visit the company has ever had, then
walks the sorted list and keeps the first `completed`/`inprogress` row per
branch.

| | |
|---|---|
| **Reached from** | `/places` (branch register), `/dashboard` (attention panel), the create-visit modal (Batch 10 branch context) — all via `fetchPlaceOperations` |
| **Why acceptable now** | 16 visits. The sort is what the query is for, and one pass answers it |
| **Becomes risky at** | roughly 10,000 visits, where payload size rather than query time starts to hurt on mobile. Sooner if a `db-max-rows` ceiling exists |
| **Replacement** | `DISTINCT ON (place_id) … ORDER BY place_id, scheduled_date DESC` in a Postgres view, or an RPC returning one row per branch. Wants an index on `visits(company_id, place_id, scheduled_date DESC)` — the existing `idx_visits_scheduled_date` cannot serve the per-branch grouping |

An interim step that needs no migration: bound the read to the last ~90 days and
treat anything older as "not visited recently", which is what every consumer
actually asks. That changes displayed semantics, so it is a product decision,
not a refactor.

---

## 2. `fetchPlaceOperations`

`src/services/places.ts` — `fetchBranchLastVisits()` + all of `place_products`.

Inherits §1 entirely, and adds an unbounded `place_products` read
(`select("place_id, is_mandatory")`, no filter).

| | |
|---|---|
| **Reached from** | Same three screens as §1 |
| **Why acceptable now** | `place_products` is bounded by branches × assortment size, which grows far slower than visits |
| **Becomes risky at** | 200 branches × 300 SKUs = 60,000 rows. Uncomfortable, not fatal |
| **Replacement** | Fold the counts into the same view as §1 so one call answers the whole branch register |

Note it is **cached and shared**: `/places`, the dashboard and the create-visit
modal all use one query key, so opening the modal is usually free. That sharing
is why the modal could add branch context in Batch 10 without a new query.

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

## 8. Priority order, if this is ever picked up

1. **`company_attention` view** — §6. Highest traffic, removes two whole-table scans.
2. **Last-visit-per-branch view + composite index** — §1. Removes the largest single payload.
3. **`product_coverage` view** — §3. Easiest of the three; mind the orphan LEFT JOIN.
4. **Reports RPC** — §5. Largest effort, least urgent while ranges stay short.

Nothing here is urgent at current volumes. All four are cheap to write and hard
to retrofit under pressure, which is the argument for writing them before they
are needed rather than after.
