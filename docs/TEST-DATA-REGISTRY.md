# TEST data registry — CLEANED UP 2026-09-04

Every row created in the **live production database** to verify a feature, and
the record of removing them.

**Status: complete.** The cleanup ran on 2026-09-04. Nothing on the original
list remains, with two deliberate exceptions recorded in §4 and §5 below.

This file is kept rather than deleted because the exceptions still matter, and
because §6 records what the cleanup cost — which is the part worth reading
before creating TEST data in production again.

---

## 1. What was removed

All ids were read from the database immediately before deletion, and every
delete returned the rows it removed as confirmation.

| # | What | Count | Detail |
|---|---|---|---|
| 1 | Visits | 5 | `4a59b69d` `467bcbdd` `ab4e7a0d` `68259b7c` `39d65db1` |
| 2 | Assortment rows | 2 | both on `TESTP1`; the خريص row was left alone |
| 3 | Templates | 2 | `TEST Claude Verify Template AR`, `TEST قالب تحليل` |
| 4 | Products | 3 | `TESTSKU1`, `TEST-CLAUDE-VERIFY-SKU`, `TEST-CLAUDE-B5-UNASSIGNED` |
| 5 | Branches | 2 | `TESTP1`, `TCVPLACE1` |
| 6 | Chains | 1 | `TESTCH` |

Cascades removed 2 `visit_products` and 2 `visit_template_responses` with the
visits, and 2 `template_fields` with their template. The 13 `visit_products` and
16 responses belonging to real visits were untouched.

### Counts, before and after

| Table | Before | After |
|---|---|---|
| `visits` | 19 | 14 |
| `places` | 4 | 2 |
| `products` | 4 | 1 |
| `templates` | 3 | 1 |
| `chains` | 3 | 2 |
| `place_products` | 3 | 1 |
| `visit_products` | 15 | 13 |
| `visit_template_responses` | 18 | 16 |

---

## 2. What was reverted rather than deleted

**`TEST حالة الرف`** (`8e350a2b-bf17-4877-8496-e5f3feaac462`) was set back to
optional before its template was deleted, so the revert is recorded even though
the row no longer exists.

**The recurring schedule** `4c4591a2-eadc-4050-9aff-1d157bcee4bf` (Ahmed →
خريص, Wednesdays) was **deactivated, not deleted**. It points at a real branch,
so it may be a genuine planning rule rather than test scaffolding. It had
generated nothing — every visit in the database has `schedule_id = null`.

---

## 3. What was never TEST data

`خريص` (code `523689`, chain كارفور) and its product
`جونيور ميني كرواسان شوكولا` (SKU `05236`) are real. Several TEST visits were
created against خريص because it was the only branch with both an assortment and
no coordinates. The visits went; the branch and product stayed.

---

## 4. The exception: a real visit on a TEST branch

**This is why the cleanup was planned before it was executed.**

Visit `9e8b6438-3a8a-4ac1-a4f6-4810f3d97574` — created 2026-09-02, in progress,
using the real template `مراجعة الستورات`, no TEST marker — sits on what was
then the TEST branch `TCVASSIGN1`. Somebody created it in normal use after the
registry was written.

`visits.place_id` is `ON DELETE CASCADE`. Deleting that branch would have
silently destroyed a real in-progress visit.

**Resolution:** the branch was kept and renamed, and its parent chain with it.

| Was | Now |
|---|---|
| place `TCVASSIGN1` / TEST Claude Verify Assigned AR | **`BR-001` / فرع ١ / Branch 1** |
| chain `TCVCHAIN` / TEST Claude Verify Chain AR | **`CH-001` / سلسلة ١ / Chain 1** |

> **These names are placeholders.** They were chosen to remove the TEST label
> from production, not because they describe anything. Whoever knows what this
> branch actually is should rename it properly.

---

## 5. The other exception: TEST values on a real member

Member `af548bf7-d0c4-4504-bd6f-a19a87262300` (`ahmednashed1991`, active
merchandiser) still carries:

- `emp_id = "TEST-EMP-001"`
- `region = "TEST Region"`

The member is real, so deleting the row was never an option, and the correct
replacement values are not knowable from here — clearing them to `NULL` is a
guess, and inventing an employee id would be worse. **Left as-is, deliberately,
for someone who knows the real values.** `TEST-EMP-001` is visible on `/users`
until then.

### Activity log entries

The dashboard activity feed shows two entries naming
`TEST Claude Verify Assigned EN` — the branch's name at the time the real
2026-09-02 visit was created and started. These are audit records of real
events. Rewriting them to match the new name would falsify history, so they were
left alone; they age out of the feed on their own.

---

## 6. What this cost, and what to do differently

The data was cheap to create and expensive to remove, and almost all of the
expense was in one thing: **a real record attached itself to test scaffolding
while nobody was looking.** The registry said `TCVASSIGN1` was disposable. Six
days later it was not, and nothing in the repository would have caught that —
only reading the live rows before deleting did.

Practical conclusions, in order of usefulness:

1. **Re-read live state immediately before deleting.** The registry was accurate
   when written and wrong when used. Plan from the database, not the document.
2. **Prefer a branch nobody would use.** The TEST branches that stayed clean
   were the ones that looked obviously fake. `TCVASSIGN1` had an assignee, so it
   showed up in normal workflows and eventually got used.
3. **Delete sooner.** Every day TEST data survives is another chance for
   something real to reference it.
4. **Cascades are the hazard, not the rows themselves.** `ON DELETE CASCADE` on
   `visits.place_id` is what turned "delete a test branch" into "destroy a real
   visit". Check what cascades before deleting a parent row.

---

## 7. Verification after cleanup

Checked in production while logged in, 2026-09-04. Zero failed requests on every
page, measured per-document with `PerformanceResourceTiming` rather than the
console, which does not clear between navigations.

| Surface | Before | After |
|---|---|---|
| Dashboard overdue visits | 6 | **1** — the real 2026-09-02 visit |
| Dashboard "بدون تشكيلة منتجات" | 2 فرع | **1 فرع** — `BR-001` |
| Dashboard orphan product | 1 منتج | **item gone** |
| `/places` | 4 rows | **2** — خريص, فرع ١ |
| `/products` | 4 rows | **1** — جونيور ميني كرواسان شوكولا |
| `/templates` | 3 | **1** — مراجعة الستورات |
| `/visits` | TEST visits listed | none; day view reads لا توجد زيارات |
| `/reports` | TEST branches in filters | only خريص and فرع ١ |
| `/users` | 3 members | 3 members, unchanged |

No TEST string remains in `places`, `products`, `templates`, `chains`,
`template_fields`, or any visit's notes. The two exceptions in §4 and §5 are the
only traces left.

**A note on one number:** the dashboard now reads `1 زيارات متأخرة`, which is the
wrong Arabic plural for one — it should be a singular form. That wording was
always there; it was invisible while the count was 6. It is a display bug in the
overdue-visits label, not a counting error, and it is unrelated to this cleanup.
