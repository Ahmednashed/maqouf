# TEST data registry

Every row created in the **live production database** to verify a feature.
None of it is customer data; all of it is safe to delete once the feature it
demonstrates no longer needs a live example.

Nothing in this file has been deleted or modified by the batch that wrote it.
It is a record, not an action.

**Captured:** end of Phase 2 Batch 14, against `main` @ `72bf61d`.

> Ids below were read from the running app (select option values and route
> params), not from memory. Where an id is not listed, the row is identified by
> a unique business key — code, SKU or name — which is what you would search on
> in the Supabase table editor anyway.

---

## 1. Why this exists

Verification kept hitting the same wall: a feature could only be proven against
data that did not exist yet. Rather than fake it in the UI, real rows were
created and prefixed so they can be found and removed. The cost of that choice
is this document — without it the prefixes are the only trace, and nobody
remembers which visit demonstrated which guardrail.

---

## 2. Deletion order

Foreign keys make the order matter. Work top to bottom.

| # | What | Why it must go first |
|---|---|---|
| 1 | Visits (`visits`) | `visit_products` and `visit_template_responses` cascade from them |
| 2 | The template field revert (see §4) | Not a delete — a setting to put back |
| 3 | Branch assortment rows (`place_products`) | Reference both places and products |
| 4 | Templates + their fields | Referenced by `visits.template_id`; delete visits first |
| 5 | Products | Referenced by `place_products` |
| 6 | Places | Referenced by visits, schedules, `place_products` |
| 7 | Chain | Referenced by places |
| 8 | Recurring schedule | Independent, but generates visits — deactivate before deleting visits or it may regenerate them |

**Do the schedule (§6) before the visits** if you want the deletion to stick.
The generator materialises a rolling 30-day window, so deleting a generated
visit while its schedule is still active can simply bring it back.

---

## 3. Visits

All three are on branch خريص or TEST فرع تحليل الرياض, all assigned to `Ahmed`
(`company_users.id` = `1fa6f4fe-ee13-4c28-b612-f8f2bd81c807`).

| Id | Date | Branch | Status | Notes marker | Demonstrates |
|---|---|---|---|---|---|
| `4a59b69d-9e63-4efc-971f-50db9a558707` | 2026-08-29 | خريص | **in progress** | `TEST-CLAUDE-B13` | Batch 13 — template answer state, response dirty-detection, the Batch 12 blank-revert fix |
| `467bcbdd-1a74-49d8-b12a-ca1bba6deffc` | 2026-08-29 | خريص | **in progress** | `TEST-CLAUDE-B11` | Batch 11 — completion readiness, acknowledgement gate; Batch 12 — product dirty/save-safety |
| `ab4e7a0d-3f18-4ddf-b459-45d5c22e0474` | 2026-08-29 | TEST فرع تحليل الرياض | pending | `TEST-CLAUDE-VERIFY batch7` | Batch 7 — the "visits today" column on /users; Batch 8 — the planned-visit panel |

### Attached rows that cascade

- `4a59b69d` holds **saved template responses**: `TEST حالة الرف = "جيد"`, and
  `TEST ملاحظات = ""` (an empty string, written while restoring a test value —
  functionally identical to no row, since both read as unanswered).
- `4a59b69d` and `467bcbdd` each hold one seeded `visit_products` row with
  `qty_found = NULL`, written by `initVisitProducts()` at start-of-visit.

### Two older TEST visits, not created for a specific batch

| Id | Date | Template | Used by |
|---|---|---|---|
| `39d65db1-b3cb-4dcb-9dab-10da70fcb312` | 2026-08-26 | TEST Claude Verify Template AR | Batch 8 — visit **with** a template |
| `68259b7c-e2ad-4e02-a6b9-2a155d8140d8` | 2026-08-26 | none | Batch 8 — visit **without** a template (the contrast case) |

These two are the only pair that discriminates the "no template attached"
empty state. Deleting one without the other loses that.

---

## 4. Template change to revert — not a delete

**Template** `2f38d3e9-d5c9-44cc-bbce-fb2e486ee866` — *TEST Claude Verify
Template AR*.

Its field **`TEST حالة الرف`** was switched from optional to **required** during
Batch 13, because no template in the database had a required field and the
required-field completion warning could not otherwise be seen with real data.

**To revert:** /templates → open the template → field 1 → pencil → toggle
`مطلوب` off → حفظ.

Reverting also removes the required-field gap that currently shows on pending
visit `39d65db1`.

---

## 5. Reference data

| Kind | Identify by | Id | Notes |
|---|---|---|---|
| Chain | `TEST Claude Verify Chain AR` | — | Parent of the two TCV branches |
| Place | code `TCVASSIGN1` | `3908bfc7-f93c-439a-a0b0-a53535d97396` | Assigned to Ahmed; no coordinates; no assortment |
| Place | code `TCVPLACE1` | `5f93fca8-2257-41ac-b180-98945e10e4c9` | Unassigned; no coordinates; no assortment |
| Place | code `TESTP1` (TEST فرع تحليل الرياض) | `b45ece62-1090-4723-bd32-e2645d894c84` | **Has coordinates** `24.7136, 46.6753`; 2 products, 1 mandatory |
| Template | `TEST Claude Verify Template AR` | `2f38d3e9-d5c9-44cc-bbce-fb2e486ee866` | Published, 2 fields — see §4 |
| Template | `TEST قالب تحليل` | `98020d3b-10ab-41c5-a96f-0223cea964ef` | **Draft, 0 fields** — the only row proving the draft/empty disabled options |
| Product | SKU `TEST-CLAUDE-VERIFY-SKU` | — | Assorted to TESTP1, mandatory |
| Product | SKU `TESTSKU1` | — | Assorted to TESTP1, optional, min stock 3 |
| Product | SKU `TEST-CLAUDE-B5-UNASSIGNED` | — | **Assorted to nothing** — the only row proving Batch 5's orphan-product detection and Batch 6's attention item |
| Member | `ahmednashed1991` | `af548bf7-d0c4-4504-bd6f-a19a87262300` | Carries `emp_id = TEST-EMP-001` and `region = TEST Region` |

`TESTP1` is the **only branch in the database with coordinates**. Deleting it
makes every GPS surface uniformly empty and removes the discriminating case for
Batch 9.

---

## 6. Recurring schedule

One active weekly schedule: **Ahmed → خريص, Wednesday 01:00, weekly, no
template**. Visible at `/visits?tab=recurring`.

It generates visits on a rolling 30-day window. **Deactivate it before deleting
TEST visits**, or generated occurrences may reappear.

---

## 7. What is *not* TEST data

`خريص` (code `523689`, chain كارفور) and its product
`جونيور ميني كرواسان شوكولا` are **real records**. Several TEST visits were
created against خريص because it is the only branch that has both an assortment
and no coordinates — the combination Batch 11's no-GPS start path needs.

Delete the visits. **Do not delete the branch or its product.**

---

## 8. Side effects while this data exists

These are correct readings of real rows, not bugs, and they revert on cleanup.

| Surface | Shows | Because |
|---|---|---|
| Dashboard timeline | 3 visits today | the three TEST visits dated 2026-08-29 |
| Dashboard attention | 4 items, not 5 | خريص has an in-progress visit today, so it is no longer >14 days stale |
| /users | Ahmed: `3 · 0 مكتملة · 3 مفتوحة` | Batch 7 workload counts them |
| /reports | 9 visits total, GPS started 6 | includes the TEST visits |
| /places | خريص last visit `اليوم` | an in-progress visit counts as a visit |
| GPS report | `5–6 زيارة إلى فرع بلا إحداثيات` | خريص has no coordinates |
