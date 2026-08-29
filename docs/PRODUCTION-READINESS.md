# Production readiness — end of Phase 2 Batch 15

State of the deployed app, what is known to be imperfect, and the checklist each
future batch should run before calling itself verified.

**Deployed:** `main` @ `b3caf205bb148408a6eff7cbb24abc293133a6e0`
**Environment:** https://malgofappv1.vercel.app (Vercel, region `fra1`)
**Captured:** Batch 14. **Updated:** Batch 16, after the Batch 15 service swap.

> **This build requires migrations 022 and 023 to be applied.** It is the first
> release whose correctness depends on database state the repository cannot
> verify. See §8 before deploying it anywhere new.

---

## 1. What Batches 1–15 did

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

Two batches (6 and 9) removed things that were actively misleading. Batch 13
fixed a defect introduced by Batch 12 — found only because Batch 13 finally had
a template to type into. Batch 15 did the same to itself: swapping the service
exposed that `/places` turned a failed query into "never visited" for every
branch, which was fixed in the same batch.

Batch 15 is also the first change whose correctness depends on database state
the repository cannot guarantee — see §8.

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

## 4. TEST data currently live

Three TEST visits, one modified TEST template field, and a set of TEST
reference rows are live in production. They are correct data producing correct
readings — not bugs — and every effect reverts on cleanup.

Full inventory, dependency order and revert instructions:
**[`TEST-DATA-REGISTRY.md`](./TEST-DATA-REGISTRY.md)**.

Expect these figures while it exists: dashboard timeline **3**, attention **4
items** (not 5), `/users` Ahmed **3 مفتوحة**, `/reports` **9 visits / GPS
started 6**, `/places` خريص last visit **اليوم**.

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
change. From `b3caf20` onward that is no longer true.

### What this build requires

| Object | From | Must be |
|---|---|---|
| `public.v_branch_operations` | migration 022 | exists, `security_invoker=true` |
| `SELECT` for `anon`, `authenticated` | migration 023 | granted |
| PostgREST schema cache | migration 023 | reloaded after the above |

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

## 9. Migration history — an open bookkeeping gap

Migrations **022 and 023 were applied by hand in the SQL Editor**, not by the
migration runner. So `supabase_migrations.schema_migrations` most likely has no
record of either, and the repository's `supabase/migrations/` directory is ahead
of what the database believes it has run.

Both are idempotent — `create index if not exists`, `create or replace view`,
`grant`, `notify` — so a future `db push` re-running them should be harmless.
The risk is confusion, not corruption.

### Read-only diagnostic

Run in the SQL Editor. Changes nothing.

```sql
-- What the database believes it has applied
select version, name, inserted_at
from supabase_migrations.schema_migrations
order by version;

-- Narrowed to the two in question
select version
from supabase_migrations.schema_migrations
where version in ('022', '023');
--   0 rows  → the gap is real
--   2 rows  → history is already correct, nothing to do
```

The CLI equivalent, also read-only, is `supabase migration list --linked` — but
see the warning below before linking.

### If the gap is real

**The official command is `supabase migration repair`,** which updates the
history table without executing the migration:

```bash
supabase migration repair --status applied 022 023
```

**Do not run it yet.** Two things must be checked first, and one of them is
genuinely unresolved:

1. **This working copy has never been linked.** `supabase/.temp/project-ref`
   does not exist. `repair --linked` would need a link, which needs the database
   password — and would repair whatever project the link points at.

2. **An earlier `supabase db push` reported success while the view did not
   exist in production.** That is unexplained. Until it is, the CLI cannot be
   assumed to be talking to this database, and `repair` would then write history
   rows into the wrong one. That is worse than the gap it fixes: a database
   would claim to have run migrations it never saw.

So the order is: understand where that push went, *then* link, *then* verify
with `migration list` that the remote history matches expectations, *then*
repair.

### Manual INSERT — not recommended

Writing rows into `supabase_migrations.schema_migrations` directly would also
close the gap, and it is deliberately **not** given here as the default. It
hand-edits the ledger the tooling trusts, with no validation that the migration
really ran, and a wrong version string or a mismatched hash silently teaches the
runner to skip a migration that was never applied. `repair` exists for exactly
this and should be preferred once the targeting question above is settled.

### Doing nothing is also defensible

The gap costs one surprise on the next `db push` — two idempotent migrations
listed as pending. If the CLI is not being used to deploy migrations anyway, the
honest fix may simply be to record that the SQL Editor is the deployment path
for this project, and keep this section current.
