# Recurring visit generation — production enablement runbook

Covers migrations **019**, **020** and **021**.

> ## Status: NOT ENABLED
>
> - No migration has been applied to production.
> - The Vercel cron entry is deliberately **absent** from `vercel.json`.
> - Everything below is the enablement procedure. Execute it deliberately,
>   in a staging project first.

---

## 0. The three migrations must be applied TOGETHER, IN ORDER

| # | File | Adds |
|---|---|---|
| 019 | `019_schedule_visit_generation.sql` | `visits.schedule_id`, `schedules.anchor_date`, `uq_visits_schedule_occurrence`, audit action |
| 020 | `020_schedule_template_and_reconcile.sql` | `schedules.template_id`, `v_untouched_generated_visits` |
| 021 | `021_reconcile_view_security_invoker.sql` | **security fix** — recreates the view with `security_invoker = true` |

### ⚠️ WARNING — applying 020 without 021 is a cross-tenant data risk

Migration 020 creates `v_untouched_generated_visits` **without**
`security_invoker`. PostgreSQL views default to `security_invoker = false`,
which means the view body executes with the privileges of the **view owner**.
The migration runner owns both the view and the `visits` table, and **row-level
security is not enforced for a table's owner**.

Consequence: with 020 applied and 021 missing, **any authenticated user of any
company** can `select * from v_untouched_generated_visits` and read the ids,
company ids, schedule ids and scheduled dates of untouched generated visits
belonging to **every tenant in the database**.

This is latent while only the service-role generator reads the view (service
role bypasses RLS regardless), but it becomes an **active leak** the moment a
user session reads it — which is exactly what
`POST /api/schedules/[id]/reconcile` does.

**Therefore:**

- Never apply 020 to any shared or production database without applying 021 in
  the same maintenance window, immediately afterwards.
- If 020 has already been applied somewhere without 021, treat it as an open
  finding and apply 021 now.
- Do not deploy the application build containing the reconcile endpoint until
  021 is verified (step 5).

021 does not rewrite 020 — it is an idempotent `create or replace view` and is
safe to re-run.

---

## 1. Safe rollout sequence

Run steps **1 → 14 in order**. Do not skip ahead; several steps are gates.

### Step 1 — Backup

Supabase Dashboard → **Database → Backups** → take an on-demand backup, or:

```bash
pg_dump "$DATABASE_URL" --schema=public --no-owner --no-privileges \
  -f malgoof-pre-019-$(date +%Y%m%d-%H%M).sql
```

Confirm the backup completed **before** continuing.

### Step 2 — Apply 019

Supabase SQL Editor → paste the full contents of
`019_schedule_visit_generation.sql` → Run.

Read the notices. If you see:

```
[019] SKIPPED uq_visits_schedule_occurrence: duplicate (schedule_id, scheduled_date) rows exist.
```

**stop.** Generation is not idempotent without that index. De-duplicate, then
create the index manually, then continue.

Expected on a clean database: `[019] OK: uq_visits_schedule_occurrence created.`

### Step 3 — Apply 020

Paste `020_schedule_template_and_reconcile.sql` → Run.

### Step 4 — Apply 021 IMMEDIATELY

Paste `021_reconcile_view_security_invoker.sql` → Run.

Do not pause, deploy, or hand the database to anyone between steps 3 and 4.
See the warning above.

### Step 5 — Verify the view is `security_invoker` (GATE)

```sql
select
  c.relname,
  c.reloptions,
  coalesce('security_invoker=true' = any(c.reloptions), false) as is_security_invoker
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'v_untouched_generated_visits';
```

**Required result:** `is_security_invoker = true` and `reloptions` containing
`security_invoker=true`.

If it is `false` or `reloptions` is NULL, 021 did not take effect. **Stop and
re-run 021.**

> Note: you cannot verify tenant isolation by querying the view from the
> Supabase SQL editor — that session runs as a privileged role and will see
> every row either way. The `reloptions` check above is the authoritative
> verification. An end-to-end check requires a real non-admin session
> (step 13).

### Step 6 — Verify constraints, columns and indexes (GATE)

Run all five queries. Every one must return the expected row.

**6a. `visits.schedule_id` exists, is nullable, and is `ON DELETE SET NULL`**

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'visits'
  and column_name  = 'schedule_id';
-- expect: schedule_id | uuid | YES

select con.conname, pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace n on n.oid = rel.relnamespace
where n.nspname = 'public'
  and rel.relname = 'visits'
  and con.contype = 'f'
  and pg_get_constraintdef(con.oid) ilike '%schedule_id%';
-- expect a definition containing: REFERENCES schedules(id) ON DELETE SET NULL
```

`ON DELETE CASCADE` here would be a **critical defect** — deleting a schedule
would erase visit history. If you see CASCADE, stop and fix the constraint.

**6b. `schedules.anchor_date` exists and is fully backfilled**

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'schedules'
  and column_name  = 'anchor_date';
-- expect: anchor_date | date | YES

select count(*) as schedules_missing_anchor
from public.schedules
where anchor_date is null;
-- expect: 0
```

Any row with a NULL anchor is skipped by the generator and reported as
`missing_anchor_date` in `failed[]`.

**6c. `schedules.template_id` exists with the right FK**

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'schedules'
  and column_name  = 'template_id';
-- expect: template_id | uuid | YES

select con.conname, pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace n on n.oid = rel.relnamespace
where n.nspname = 'public'
  and rel.relname = 'schedules'
  and con.contype = 'f'
  and pg_get_constraintdef(con.oid) ilike '%template_id%';
-- expect a definition containing: REFERENCES templates(id) ON DELETE SET NULL
```

`template_id` is **nullable by design** — the product supports template-less
visits. See §3.

**6d. `uq_visits_schedule_occurrence` exists, is UNIQUE and is PARTIAL**

```sql
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename  = 'visits'
  and indexname  = 'uq_visits_schedule_occurrence';
-- expect indexdef:
--   CREATE UNIQUE INDEX uq_visits_schedule_occurrence ON public.visits
--   USING btree (schedule_id, scheduled_date) WHERE (schedule_id IS NOT NULL)
```

**This index is the entire idempotency guarantee.** If it is missing, the
generator can create duplicate visits. Do not proceed without it.

Belt-and-braces duplicate check:

```sql
select schedule_id, scheduled_date, count(*)
from public.visits
where schedule_id is not null
group by schedule_id, scheduled_date
having count(*) > 1;
-- expect: 0 rows
```

**6e. Supporting indexes present**

```sql
select indexname
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'idx_visits_schedule',
    'idx_schedules_active',
    'idx_schedules_template',
    'idx_visit_products_visit',
    'idx_vtr_visit_lookup'
  )
order by indexname;
-- expect all five
```

### Step 7 — Assign templates to active schedules (optional but recommended)

List active rules that would generate visits with no checklist:

```sql
select s.id, s.company_id, s.day_of_week, s.frequency,
       p.branch_en as branch,
       u.full_name as merchandiser
from public.schedules s
left join public.places        p  on p.id  = s.place_id
left join public.company_users cu on cu.id = s.merch_id
left join public.users         u  on u.id  = cu.user_id
where s.is_active
  and s.template_id is null
order by s.company_id, p.branch_en;
```

Assign them in the app: **Visits → الجداول المتكررة → edit → Checklist**.
This is a product decision, not a technical blocker — template-less visits are
valid and will still generate. Whatever remains NULL is reported as
`schedulesWithoutTemplate` on every run.

### Step 8 — Set `CRON_SECRET`

Vercel → Project → **Settings → Environment Variables** → add `CRON_SECRET`
(a strong random string, e.g. `openssl rand -hex 32`) for the target
environment → **Redeploy** so the value is present at runtime.

The endpoint **fails closed**: with `CRON_SECRET` unset every request returns
401.

### Step 9 — Dry run (writes nothing)

```bash
curl -s -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  "https://<host>/api/cron/generate-visits?dryRun=true" | jq
```

### Step 10 — Inspect the counters and failed schedules (GATE)

```jsonc
{
  "dryRun": true,
  "window": { "from": "…", "to": "…" },   // today → today+30, Riyadh dates
  "schedulesProcessed": 0,
  "occurrencesEvaluated": 0,
  "visitsInserted": 0,                    // what WOULD be created
  "duplicatesSkipped": 0,
  "staleVisitsDeleted": 0,                // what WOULD be removed
  "visitsRetemplated": 0,
  "protectedVisits": 0,                   // operational rows left alone
  "schedulesWithoutTemplate": 0,
  "failures": 0,
  "failed": []
}
```

Check each of these before continuing:

- `window.from` is **today's Riyadh date**, `window.to` is exactly 30 days later.
- `schedulesProcessed` matches your active schedule count.
- `visitsInserted` is plausible (roughly: weekly rules × ~4, biweekly × ~2,
  monthly × 1).
- `staleVisitsDeleted` should be **0** on a first run. Anything above 0 on a
  virgin database means schedules were edited between migration and dry run —
  understand why before proceeding.
- `failures` is **0** and `failed` is empty. Investigate every entry:
  `missing_anchor_date`, `unsupported_frequency`, `invalid_day_of_week`.

### Step 11 — One real generation, manually

```bash
curl -s -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  "https://<host>/api/cron/generate-visits" | jq
```

Confirm `visitsInserted` matches the dry run. Then prove idempotency by
running the **exact same command again**:

```bash
curl -s -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  "https://<host>/api/cron/generate-visits" | jq '.visitsInserted, .duplicatesSkipped'
```

**Required:** `visitsInserted` is now `0` and `duplicatesSkipped` equals the
first run's insert count. If the second run inserts anything, the unique index
is missing — go back to step 6d.

### Step 12 — Inspect the generated visits in the UI

Open **Visits → اليوم / القادمة**. Verify:

- generated visits appear on the correct dates
- each shows the quiet **"Recurring / متكرر"** chip
- branch, merchandiser and status (`pending`) are correct
- opening one shows its checklist when the schedule has a template
- manual visits are unchanged and carry **no** chip

Cross-check the audit trail:

```sql
select action, count(*)
from public.activity_logs
where action in ('visit.created', 'visit.generated_from_schedule')
  and created_at > now() - interval '1 hour'
group by action;
-- generated visits log 'visit.generated_from_schedule' (actor = system)
```

### Step 13 — Test immediate reconciliation on a schedule edit (GATE)

Signed in as an **owner or admin**, edit one recurring schedule (change the
weekday, or attach a different checklist) and save.

Expected:
- toast: schedule updated
- toast: upcoming visits updated to match the schedule
- future untouched generated visits move to the new day / adopt the new template
- **any started, completed, missed, noted, checked-in, product-audited or
  checklist-answered visit is unchanged**, as is anything dated today or earlier

Then verify tenant isolation with a **real non-admin session** (this is what
step 5 could not prove):

- sign in as a **merchandiser** and confirm they cannot reconcile
  (403 `insufficient_role`)
- if you have a second tenant, sign in there and call
  `POST /api/schedules/<other-company-schedule-id>/reconcile` — it must return
  **404**, never 403 and never data

### Step 14 — Only now, re-enable Vercel Cron

Add to `vercel.json` and redeploy (`0 0 * * *` UTC = **03:00 Asia/Riyadh**):

```json
"crons": [
  { "path": "/api/cron/generate-visits", "schedule": "0 0 * * *" }
]
```

Confirm the job appears under Vercel → Project → **Cron Jobs**, then check the
first scheduled execution's log line the following morning:

```
[generate-visits] 2026-08-09→2026-09-08 schedules=… inserted=… skipped=… failures=0
```

---

## 2. DO NOT ENABLE CRON UNTIL

Every box must be ticked. Enabling the daily job before these are true risks
duplicate visits, cross-tenant data exposure, or destroyed operational records.

- [ ] A database backup exists and is confirmed restorable.
- [ ] Migrations **019, 020 and 021** are all applied, in that order.
- [ ] **021 is verified**: `is_security_invoker = true` (step 5).
- [ ] The application build containing the reconcile endpoint was deployed
      **after** 021, not before.
- [ ] `uq_visits_schedule_occurrence` exists, is UNIQUE and PARTIAL (step 6d);
      migration 019 did **not** print the `SKIPPED` notice.
- [ ] The duplicate-occurrence query returns **0 rows**.
- [ ] `visits.schedule_id` FK is `ON DELETE SET NULL` — **not** CASCADE.
- [ ] `schedules.anchor_date` has **0 NULLs**.
- [ ] All five supporting indexes exist (step 6e).
- [ ] A dry run completed with `failures: 0` and an empty `failed[]`.
- [ ] A real run completed, and an **immediate second run inserted 0** visits.
- [ ] Generated visits look correct in the UI and carry the Recurring chip.
- [ ] A schedule edit reconciled correctly and **left an operational visit
      untouched**.
- [ ] A merchandiser gets **403**, and a cross-tenant schedule id gets **404**.
- [ ] `CRON_SECRET` is set in the target environment and the endpoint returns
      **401** without it.
- [ ] Someone is on hand to read the first scheduled run's log.

---

## 3. Reference

### Domain boundary

| | Schedule | Visit |
|---|---|---|
| table | `schedules` | `visits` |
| meaning | recurring assignment **rule** | executable **instance** |
| created by | a manager, by hand | the generator, or by hand |
| link | — | `visits.schedule_id` (NULL = manual) |

Never merged. Deleting a schedule sets `visits.schedule_id` to NULL and keeps
every visit.

### Recurrence semantics

Derived strictly from what `schedules` can express (`day_of_week` +
`frequency` + `anchor_date`):

- **weekly** — every matching weekday on/after the anchor.
- **biweekly** — every second matching weekday, parity counted **from the
  anchor**, so the sequence never drifts between runs.
- **monthly** — the same weekday-ordinal as the anchor (anchor = 2nd Sunday →
  every month's 2nd Sunday). A month without that ordinal is **skipped, never
  shifted**.

"Same day-of-month" recurrence is **not representable** — there is no
day-of-month column — so 29/30/31 edge cases do not arise.

All dates are **Asia/Riyadh** calendar dates (UTC+3, no DST).

### Templates

`schedules.template_id` is nullable on purpose: the product supports
template-less visits (`VisitCreateModal` marks `template_id` optional; the
visit detail page renders the checklist block only when a template exists).
Requiring it would contradict the manual flow and invalidate every existing
schedule.

Missing checklists are **allowed but never silent**: amber "No checklist" badge
on the schedule row, inline warning in the modal, and a
`schedulesWithoutTemplate` counter in every run summary.

### Reconciliation safety

Two independent gates, both required before an existing visit is touched:

1. the row appears in `v_untouched_generated_visits`, **and**
2. `scheduled_date > today` (Riyadh) — strictly future.

The view excludes any visit that is not `pending`, or has `started_at`,
`completed_at`, non-zero `duration_minutes`, notes, any GPS check-in field, any
`visit_products` row, or any `visit_template_responses` row.

Anything failing either gate is counted as `protectedVisits` / `protected` and
reported — never modified, never deleted.

### Endpoints

| Endpoint | Auth | Credentials used |
|---|---|---|
| `POST /api/cron/generate-visits` | `CRON_SECRET` bearer | service-role (server-only) |
| `POST /api/schedules/[id]/reconcile` | user session cookie | **caller's own session — RLS enforced** |

Useful invocations:

```bash
# Plan only, whole company set — writes nothing
curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" \
  "https://<host>/api/cron/generate-visits?dryRun=true" | jq

# Plan only, one schedule
curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" \
  "https://<host>/api/cron/generate-visits?scheduleId=<uuid>&dryRun=true" | jq

# Apply, one schedule (admin recovery)
curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" \
  "https://<host>/api/cron/generate-visits?scheduleId=<uuid>" | jq
```

---

## 4. Rollback

### 4a. Stop generation immediately (no data change)

Remove the `crons` block from `vercel.json` and redeploy. Generation stops at
once; all data is intact. This is the correct first response to any anomaly.

For an instant stop without a deploy, rotate/clear `CRON_SECRET` — the endpoint
then fails closed with 401.

### 4b. Stop a single schedule

Set it inactive in the UI. It stops producing **new** visits; visits it already
produced are kept.

### 4c. Remove generated visits from the future window (reversible, data-losing)

Only removes visits with **zero operational footprint** — the same gate
reconciliation uses:

```sql
-- Inspect first
select count(*) from public.v_untouched_generated_visits
where scheduled_date > (now() at time zone 'Asia/Riyadh')::date;

-- Then delete
delete from public.visits
where id in (
  select id from public.v_untouched_generated_visits
  where scheduled_date > (now() at time zone 'Asia/Riyadh')::date
);
```

### 4d. Full schema rollback

```sql
drop view  if exists public.v_untouched_generated_visits;
drop index if exists uq_visits_schedule_occurrence;
drop index if exists idx_visits_schedule;
drop index if exists idx_schedules_active;
drop index if exists idx_schedules_template;

alter table public.schedules drop column if exists template_id;
alter table public.schedules drop column if exists anchor_date;
alter table public.visits    drop column if exists schedule_id;

drop trigger  if exists trg_set_schedule_anchor on public.schedules;
drop function if exists public.set_schedule_anchor();
```

Then restore the pre-019 audit trigger by re-running the
`create or replace function log_visit_activity()` block from
`012_activity_audit.sql` (§D) — 019 replaced its body to add the
`visit.generated_from_schedule` branch.

**Generated visits survive this rollback** as ordinary visits; they simply lose
their `schedule_id` link. Dropping the column is irreversible for that link —
restore from the step 1 backup if you need it back.

---

## 5. Tests

```bash
npx tsx scripts/test-recurrence.ts      # 36 — recurrence, timezone, window
npx tsx scripts/test-reconcile.ts       # 27 — templates, reconciliation, safety
npx tsx scripts/test-reconcile-auth.ts  # 16 — authz, idempotency, protection
```

All three are pure functions: no database, no network, no secrets. The
database half of the safety model (RLS, the unique index, the untouched view)
is verified by steps 5, 6 and 13 of this runbook, not by these suites.
