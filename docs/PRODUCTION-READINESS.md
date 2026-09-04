# Production readiness — end of Phase 2 Batch 18

State of the deployed app, what is known to be imperfect, and the checklist each
future batch should run before calling itself verified.

**Deployed:** `main` @ `b973dcb7ad5f80c2ab43c1418987c0bff3d8cb63`
**Environment:** https://malgofappv1.vercel.app (Vercel, region `fra1`)
**Captured:** Batch 14. **Updated:** Batch 19, after the Batch 18 service swap.

> **This build requires migrations 022, 023 and 024 to be applied.** All three
> were applied by hand in the SQL Editor and verified against production —
> 022/023 on 2026-08-29, 024 on 2026-09-04. See §10. Read §8 before deploying
> to any new environment, and re-run the §10 checks once you have.

---

## 1. What Batches 1–18 did

Each batch was merged fast-forward only and verified in production before the
next began.

| # | Area | The substantive change |
|---|---|---|
| 1 | Branch register | Last-visit and assortment columns on `/places`; one shared rule for "last visit" (`completed`/`inprogress` only, never `missed`) |
| 2 | Reports | Merchandiser / branch / status / **last-visit** filters, composing; branch coverage seeded from all active branches so uncovered ones appear |
| 3 | Visit identity | One name-resolution rule (`merchDisplayName`) across every screen, replacing per-screen guesses |
| 4 | Templates | Draft and published-but-empty templates shown as **disabled options with a reason**; Arabic plural field counts via `Intl.PluralRules` |
| 5 | Assortment | Product coverage column; orphan-product detection |
| 6 | Dashboard | **Removed fabricated content** — an AI card asserting invented findings, and a hardcoded always-rising sparkline on every KPI. Replaced with data-derived attention items |
| 7 | Users | Visits-today and assigned-branch columns; unified presence with the dashboard; 9 columns → 8 while adding two |
| 8 | Visit detail | Plan vs record — what a visit was *meant* to cover, not only what it recorded |
| 9 | Location | **Stopped reporting missing GPS as a failed check**; removed the fake map tile |
| 10 | Scheduling | Branch context when creating a visit; recurrence preview from the real generator |
| 11 | Completion | Readiness summary; acknowledgement gate before completing with gaps unrecorded |
| 12 | Save safety | Unsaved edits block completion online, warn offline; draft no longer cleared when dirty |
| 13 | Template execution | Per-field answered state; **fixed a Batch 12 false-dirty bug** that permanently blocked completion |
| 14 | Documentation | TEST-data registry, performance risk map, and this runbook |
| 15 | **Performance** | Branch operations moved into Postgres — `v_branch_operations`, migration 022. The largest read in the app, on its three most-loaded screens, stopped scaling with visit history |
| 16 | Documentation | Migration-history investigation; corrected what Batch 15 had recorded about it |
| 17 | Documentation | Read-only production drift check — proved the repository matches the database for migrations 020, 021 and 022 |
| 18 | **Performance** | Product coverage moved into Postgres — `v_product_coverage`, migration 024. The **last** unbounded read, plus an honest-unknown state on `/products` when the roll-up fails |

Two batches (6 and 9) removed things that were actively misleading. Batch 13
fixed a defect introduced by Batch 12 — found only because Batch 13 finally had
a template to type into. Batch 15 did the same to itself: swapping the service
exposed that `/places` turned a failed query into "never visited" for every
branch, which was fixed in the same batch.

Batch 18 repeated that pattern deliberately: swapping the service exposed that
`/products` turned a failed roll-up into 'no branch carries this' for every
product, which was fixed in the same batch.

Batch 15 is the first change whose correctness depends on database state the
repository cannot guarantee, and Batch 18 is the second — see §8.

---

## 2. Known warnings — unchanged and expected

`npm run build` exits **0** with **5 warnings**, all the same rule:

```
@next/next/no-img-element  — Using `<img>` could result in slower LCP …
```

| File | Line |
|---|---|
| `dashboard/_components/FieldTeamTable.tsx` | 77 |
| `users/page.tsx` | 250 |
| `users/_components/UserModal.tsx` | 338 |
| `components/layout/Topbar.tsx` | 61, 90 |

All five are **avatar images**. They predate Phase 2 and the count has not moved
across thirteen batches — which is itself the check: if a build reports anything
other than *5 warnings, 0 errors*, something new was introduced.

Switching to `next/image` would mean configuring the Supabase storage host as a
remote pattern and accepting per-image optimisation cost. That is a deliberate
decision, not an oversight, and it is not urgent for small avatars.

---

## 3. Dictionary invariant

Arabic and English must stay in lockstep: **1115 keys each, 0 duplicates, 0
gaps** at `b3caf20`. Every batch that touches `translations.ts` should re-audit.
A duplicate key is a TypeScript error (`TS1117`); a *gap* is silent, which is
why it is checked explicitly.

---

## 4. TEST data — removed 2026-09-04

The TEST rows created across Batches 1–18 to verify features against real data
were deleted on 2026-09-04. Full record, including counts before and after:
**[`TEST-DATA-REGISTRY.md`](./TEST-DATA-REGISTRY.md)**.

Removed: 5 visits, 2 assortment rows, 2 templates, 3 products, 2 branches, 1
chain, plus the rows that cascaded with them. Real data was untouched — خريص,
its product, and the 13 `visit_products` and 16 template responses belonging to
real visits all survive.

**Two traces remain on purpose, both attached to real records:**

1. A branch that had to be kept. A real in-progress visit
   (`9e8b6438`, 2026-09-02) had been created on the TEST branch `TCVASSIGN1`
   after the registry was written, and `visits.place_id` cascades on delete.
   The branch was renamed to `BR-001` / فرع ١ and its chain to `CH-001` /
   سلسلة ١ instead. **Those names are placeholders and want replacing.**

2. Member `af548bf7` (`ahmednashed1991`) still carries `emp_id =
   "TEST-EMP-001"` and `region = "TEST Region"`. The member is real and the
   correct values are not knowable from here, so they were left rather than
   guessed. `TEST-EMP-001` shows on `/users` until someone sets them.

The dashboard activity feed also shows two entries naming the branch by its old
TEST name. They are audit records of real events; rewriting them would falsify
history.

---

## 5. Verified only by unit test

Honest gaps. Each is covered by tests but has never been seen in a browser,
because production data cannot currently produce the state.

| What | Why unreachable |
|---|---|
| GPS **`verified`** and **`outside`** states | Would require a real device position inside a 200 m radius, or faking one. `startVisit` throws on out-of-radius, so `outside` is unreachable by design |
| **`false` / `0`** as template answers | No yes/no or numeric field exists on any template |
| Pending-invitations list | Needs an invitable address — see [`PENDING-VERIFICATION.md`](./PENDING-VERIFICATION.md) |
| Published-but-empty template row | The publish guard prevents the state existing; only ever observed by correct absence |

Faking any of these would produce exactly the kind of fabricated evidence
Batches 6 and 9 existed to remove. They stay unverified until real data can
produce them.

---

## 6. Known rough edges — not yet fixed

| Thing | Detail |
|---|---|
| Products list is briefly empty after starting a visit | `initVisitProducts()` writes the rows but the `visit-products` query key is not invalidated; resolves on reload. **Pre-existing** |
| Completing still does not save the audit | `handleSave` is separate. Batch 12 made this safe (unsaved work blocks completion) rather than changing the rule. Auto-save was rejected because `handleSave` silently no-ops offline |
| Offline completion can still lose work | Blocking would strand a field user, so it warns and requires acknowledgement. The draft survives, but nothing re-syncs it later |
| Photo fields excluded from drafts | A photo-only edit may not register as dirty. Not exercised — no template has photo fields |
| Two "answered" counts on one screen | The template header is **live**; the plan panel and completion dialog are **saved-based**. Intended, but they differ while edits are unsaved |
| 12 modals not on the shared `Modal` | Including `CompleteModal`. Cosmetic inconsistency |
| `STALE_AFTER_DAYS = 14` duplicated in spirit | `lib/attention.ts` and the reports `gt14` bucket carry the same number in two files |
| The "visited" rule now lives in SQL | Migration 022 defines `completed`/`inprogress`. It must stay in step with `matchesLastVisitBucket()` and the coverage report, and nothing enforces that. **New in Batch 15** |
| `product_count` counts inactive assortment rows | Reproduced in the view to preserve behaviour; still inconsistent with `initVisitProducts()` and `lib/visit-plan.ts`, which filter on `is_active` |
| Same-date last-visit ties changed | Previously arbitrary, now deterministic (`created_at`, `id`). No branch currently has tied qualifying visits, so it is untested against real data |
| Arabic plural on the overdue-visits label | The dashboard renders `1 زيارات متأخرة` — plural form for a count of one. Pre-existing and invisible while the count was 6; surfaced by the 2026-09-04 TEST-data cleanup. Batch 4 solved this properly for template field counts with `Intl.PluralRules`; this label never got the same treatment. **Display only — the count itself is correct** |
| Two branches carry placeholder names | `BR-001` / فرع ١ and `CH-001` / سلسلة ١ were named during the TEST-data cleanup to strip the TEST label from a branch that had acquired a real visit. They describe nothing and want real business names — see §4 |
| TEST values on a real member | Member `af548bf7` (`ahmednashed1991`, active) carries `emp_id = "TEST-EMP-001"` and `region = "TEST Region"`, left behind by the TEST-data cleanup. The member is real, so the row was never deletable. **Needs the owner’s real values — do not guess them, and do not blank them automatically:** an invented employee id is worse than a visibly wrong one, and `NULL` would quietly discard information someone may still hold. `TEST-EMP-001` shows on `/users` until it is set. Recorded in TEST-DATA-REGISTRY.md §5 |

Performance risks are separate and larger:
**[`PERFORMANCE-RISKS.md`](./PERFORMANCE-RISKS.md)**.

---

## 7. Deployment verification checklist

What every batch has actually run. Reproducible rather than aspirational.

### Before merge
1. `npm run type-check` → exit 0
2. `npm run build` → exit 0, **0 errors, 5 warnings** (§2)
3. Dictionary audit → equal counts, 0 dupes, 0 gaps (§3)
4. Unit tests for any new pure logic, compiled against the **byte-identical**
   source file (`diff -q` the copy before trusting the result)
5. Browser sweep on localhost while logged in
6. Console clean, including **one hard reload** — hydration errors only fire on
   initial SSR hydration, so client-side navigation hides them

### Merge
7. `git merge --ff-only`, after asserting `git merge-base --is-ancestor`
8. Re-run type-check and build **on the merged commit**, not just the branch
9. Working tree clean; report the final `main` SHA

### After push
10. Capture the served **dictionary chunk hash** *before* pushing, then poll for
    it to change. Do **not** poll the webpack runtime chunk — it does not always
    change between deploys, and it produced a false "not deployed" reading once
11. Confirm the deployed commit by **content fingerprinting**: strings added by
    the commit are present *and* strings it removed are absent. Prefer strings
    unique to the tip commit so it discriminates from the one before it
12. Re-run the browser sweep against production while logged in
13. Report exactly what production data was touched, and restore anything
    temporary

### Traps worth remembering
- **Scope DOM queries to the dialog.** The page behind a modal often contains a
  button with the same label; a page-wide `find` will grab the wrong one and
  report a gate as broken when it is not. This caused two false alarms.
- **A blank page may be skeletons.** `innerText` is empty while loading. Wait
  and re-check before concluding anything.
- **Verify by discrimination, not absence.** A count of zero proves nothing if
  every case reads zero. Change the data — or say plainly that the state could
  not be produced.
- **The console buffer does not clear on reload.** Once errors appear in the
  pane they persist across navigation, so a later "clean console" cannot be read
  off it. Instrument `fetch` across a fresh navigation instead, and report it
  as that rather than as a clean console.

---

## 8. Database-dependent releases

Everything before Batch 15 was self-contained: the deployed bundle was the whole
change. From `b3caf20` onward that is no longer true, and Batch 18 added a
second such dependency.

### What this build requires

| Object | From | Must be |
|---|---|---|
| `public.v_branch_operations` | migration 022 | exists, `security_invoker=true` |
| `public.v_product_coverage` | migration 024 | exists, `security_invoker=true` |
| `SELECT` for `anon`, `authenticated` on both | 023 (branch ops), 024 (coverage) | granted |
| PostgREST schema cache | 023 and 024 | reloaded after each |

All of it was confirmed present and correct in production — 022/023 on
2026-08-29, 024 on 2026-09-04. See §10 for the evidence and the queries that
produced it.

**Every one of these migrations was applied by hand in the SQL Editor**, 024
included, like all 24 before it. The repository cannot tell you whether they
ran — see §9.

### Failure symptom if the view is missing

The app fails **honestly but visibly** — it does not silently degrade, because
the service has no fallback and the screens gate on `isSuccess`:

| Where | What you see |
|---|---|
| Network | `404` with `{"code":"PGRST205","message":"Could not find the table 'public.v_branch_operations' in the schema cache"}` |
| `/places` | every branch's Last Visit and Assortment columns read **`—`** |
| `/dashboard` | attention panel stays in its **skeleton**, publishing no counts |
| Create-visit modal | branch context lines are **absent** (assortment, last visit) |
| `/reports` Branch Coverage | Last Visit column empty; buckets return nothing |

And if **`v_product_coverage`** (024) is the one missing:

| Where | What you see |
|---|---|
| Network | the same `PGRST205` 404, naming `public.v_product_coverage` |
| `/products` | every Coverage cell reads **`—`** with a "could not load" tooltip — **not** the orphan badge, which would have claimed no branch carries anything |
| `/dashboard` | attention panel stays in its **skeleton** (it gates on all five queries) |

**`PGRST205` does not mean "cache is stale".** PostgREST returns it for a
relation that does not exist, one the API roles cannot `SELECT`, *and* one the
cache has not picked up — all three are 404 and indistinguishable from outside.
Diagnose it in the database, not over REST:

```sql
select schemaname, viewname from pg_views
where schemaname = 'public' and viewname = 'v_branch_operations';
```

Empty result means the object is not there, and no amount of reloading or
granting will help.

### Deploy order for a database-dependent release

1. Apply the SQL.
2. Verify in the database — `pg_views`, then `pg_class.reloptions` contains
   `security_invoker=true`.
3. Verify over REST — the endpoint answers `200`, not `404`.
4. **Then** deploy the code that depends on it.

Never the other way round. Batch 15 shipped its migration three exchanges before
the code precisely so this ordering held.

---

## 9. Migration history — this database has never been CLI-managed

**Corrected in Batch 17.** This section previously described "022 and 023
missing from `supabase_migrations.schema_migrations`". That framing was wrong,
and wrong in the direction that made the situation look smaller than it is:
there is no history table at all, and there never has been.

### What the diagnostic returned

```sql
select version from supabase_migrations.schema_migrations
where version in ('022', '023');
-- ERROR 42P01: relation "supabase_migrations.schema_migrations" does not exist
```

A `pg_class` scan across every schema for relations matching `%migration%`
returned exactly three rows, all owned by Supabase's own services:

| Relation | Owner | What it is |
|---|---|---|
| `auth.schema_migrations` | `supabase_auth_admin` | GoTrue internal |
| `storage.migrations` | `supabase_storage_admin` | Storage service internal |
| `realtime.schema_migrations` | `supabase_admin` | Realtime service internal |

**All three are decoys.** They exist and are populated in every Supabase project
from day one; rows in them are not evidence of user migration history. No
`supabase_migrations` schema exists, and no legacy `public.schema_migrations`
either.

Use `pg_catalog` for this, not `information_schema` — the latter filters by
privilege, so an object you lack rights on reads as absent. Same trap as
`PGRST205` in §8: one symptom, several causes.

### The table the CLI actually uses

Confirmed by reading the CLI binary on the development machine (v2.100.1),
which carries these statements verbatim:

```sql
CREATE SCHEMA IF NOT EXISTS supabase_migrations
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text NOT NULL PRIMARY KEY)
ALTER TABLE supabase_migrations.schema_migrations ADD COLUMN IF NOT EXISTS name text
ALTER TABLE supabase_migrations.schema_migrations ADD COLUMN IF NOT EXISTS statements text[]
```

So the name is right for this CLI version. `name` and `statements` are added by
later `ALTER`s, so an older table may carry only `version` — check the shape
before assuming columns exist.

### Why it is absent

This repository was never initialised as a Supabase CLI project:

- `supabase/config.toml` does not exist and **was never committed on any branch,
  ever**. It is not gitignored, so the absence is real rather than hidden.
- `supabase/.temp/` holds only `cli-latest`. There is no `project-ref` file, so
  this working copy has never been linked to any project.

**All 23 migrations, 001 through 023, were applied by hand through the SQL
Editor.** That has been the deployment model since the beginning. It is not
something Batch 15 introduced, and 022/023 are in exactly the same state as
001–021 — which is the accurate statement, replacing "022 and 023 are missing".

It also resolves the previously-unexplained `db push` that reported success
while the view did not exist in production: with no config and no link, a push
from this directory could not have reached this project at all.

### Blast radius of an accidental `db push` — smaller than previously stated

This section used to imply a push would attempt all 23 migrations against live
production. It would not get that far.

`001_initial_schema.sql` contains **13 unguarded `CREATE TABLE` statements** and
no `IF NOT EXISTS`. A push would abort on the first one with *relation already
exists*, having applied nothing. Every destructive statement in the tree — 46
lines, all `DROP … IF EXISTS` on policies, triggers and constraints — lives in
002 and later and would never be reached.

The failure mode is **loud and safe**. Nothing here is urgent.

### The remaining operational decision

Whether to adopt CLI migration history is a real choice with a real cost. It
should be made deliberately, not drifted into.

**The former blocker is gone.** The argument against `supabase migration repair`
was that it marks versions applied *without verifying the database matches
them*, which would have frozen unknown drift into a state that then claimed to
be verified. §10 establishes there is no drift to freeze.

**What adoption would cost:** `supabase init`, then `supabase link` (which needs
the database password), then marking **all 23** versions applied — not just 022
and 023. That creates the schema and inserts 23 rows. It is a mutation, and it
deserves its own batch and its own approval.

**Not adopting is equally defensible.** Manual SQL Editor deployment is the real
process here, it has carried 23 migrations, and §10 shows it produced a database
matching the files exactly. The cost of staying as-is is narrow: `supabase
db push`, `db diff` and `migration list` are unavailable, and anyone who reaches
for one gets a confusing answer rather than a useful one.

**What is not acceptable is leaving the choice unrecorded.** Whichever way it
goes, it belongs in this file.

---

## 10. Production drift checks

Read-only verification that production matches the committed migration files
for the objects that matter. Eight `pg_catalog` queries, no mutations.

It was prompted by a specific, nameable risk rather than general caution:
migration 022 was applied using a manual SQL Editor variant written to be safe
to paste, not one guaranteed identical to the committed file. Nobody had checked
whether the two agreed.

### Batch 17 — migrations 020, 021, 022 (2026-08-29): no drift

| Checked | Expected | Found |
|---|---|---|
| `v_branch_operations` exists | yes | yes |
| — `security_invoker` | `true` | `true` |
| — column shape | 7 columns; `last_visit_status` is the `visit_status` enum | exact match |
| — definition | the semantics of 022 | semantically identical |
| — `SELECT` for `anon` / `authenticated` | granted | both granted |
| `v_untouched_generated_visits` | the 021 state, not the unsafe 020 one | 021 — body **and** comment |
| — `security_invoker` | `true` | `true` |
| `idx_visits_place_date` | `(place_id, scheduled_date DESC)`, valid | exact match, valid |
| `idx_schedules_template`, `idx_visit_products_visit`, `idx_vtr_visit_lookup` | present, valid | all present and valid |
| `schedules.template_id` | nullable `uuid`, `ON DELETE SET NULL` | exact match |
| RLS on `visits`, `places`, `place_products` | enabled, with policies | enabled; 4 / 4 / 3 policies |

The comment on each view was compared character by character against the
committed file. `v_untouched_generated_visits` carries **021's** comment, not
020's — and since `create or replace view` and `comment on view` are separate
statements, that shows 021 ran to completion rather than being partially pasted.

### How to read a `pg_get_viewdef` comparison

The live definition never matches the migration file textually. Postgres
re-renders it from the parse tree: `in (…)` becomes `= ANY (ARRAY[…])`, literals
gain explicit casts (`0::bigint`), redundant aliases are dropped, and the whole
thing is re-indented and schema-qualified. **Textual difference is not drift.**

Compare the load-bearing elements instead. For 022 those are:

- the `status in ('completed','inprogress')` filter — the definition of "visited"
- the `scheduled_date desc, created_at desc, id desc` tiebreak
- the `limit 1` inside the lateral join
- `count(*)` with **no** `is_active` filter — the deliberate inconsistency with
  `initVisitProducts()` is preserved, not silently corrected

All four survived. For 021: all twelve `WHERE` conditions and both `NOT EXISTS`
probes are present and unmodified.

### One observation, not a defect

`anon` and `authenticated` hold `INSERT`, `UPDATE`, `DELETE` and `TRUNCATE` on
`v_branch_operations`, not only `SELECT`. Migration 023 granted `SELECT`; the
rest arrive from Supabase's project-wide default privileges at `CREATE VIEW`
time. Every table in `public` looks the same.

It is inert on this view — lateral joins, aggregates and a `LIMIT` make it
non-auto-updatable, so writes fail regardless of the grant. RLS is the real
boundary either way, and it is enabled on all three base tables above.

### What this buys, and what it does not

Before this check, the repository was *assumed* to describe production. For
these objects it is now evidenced. The warning at the top of this file — a
release depending on database state the repository cannot verify — was accurate
when written and is discharged for `b3caf20`.

It says nothing about the next database-dependent release. Re-run this check
whenever one ships, before trusting the code that depends on it.

---

### Batch 18 — `v_product_coverage`, verified 2026-09-04

The same order was followed for migration 024, and this time before the code
shipped rather than after: applied by hand, verified in the database, confirmed
over REST, then the service swap was pushed.

**Deployed SHA:** `b973dcb7ad5f80c2ab43c1418987c0bff3d8cb63`.

**How the deployment was confirmed, and a caveat worth keeping.** The SHA could
not be established from asset hashes: the `webpack` chunk was unchanged, and
`/login`'s chunk set was byte-identical because login imports nothing this batch
touched. App Router HTML carries no build id either. A cache reset proved *a*
deployment landed, not which one.

What settled it was a **functional fingerprint**: production `/products` issues
`GET /rest/v1/v_product_coverage`, a string that exists in no earlier build.
Prefer that over hash comparison for any release whose changed routes are
auth-gated.

| Checked in production, logged in | Result |
|---|---|
| `/products` reads `v_product_coverage` | 200, no `PGRST205` |
| Four coverage values vs pre-swap | identical |
| Dashboard orphan-product count | **1**, unchanged |
| `place_products` coverage scan | **absent** from `/products`, `/dashboard`, `/places`, `/reports` |
| `/places`, `/reports` | intact, real data, no skeletons |
| Live request failures | **0** on all four pages |

**Equivalence was proved against live data before the swap shipped**, not
inferred: the old reduction and the view were run side by side in the page
context with a real session and the two maps diffed. Zero mismatches. The view
additionally returned the one orphan product with `branch_count 0` where the old
map had no entry — the documented shape difference.

**On reading the console during this check.** The buffer does not clear across
navigations and still held 404s from a deliberate failure test. Per-document
`PerformanceResourceTiming.responseStatus` resets on every navigation, so it
separates live failures from stale ones; that is what the zero above rests on.

A `window.fetch` override captures **nothing** from Supabase calls —
`/supabase-js` binds `fetch` when the client is constructed, before any
later override. It fails silently, which is worse than failing loudly. Use
performance entries for this app.
