-- ─────────────────────────────────────────────────────────────────────────────
-- 019 — Automatic visit generation from recurring schedules
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Schedules stay PLANNING RULES; visits stay EXECUTABLE INSTANCES. This
-- migration only adds the link, the anchor the recurrence math needs, and the
-- database-level guarantee that generation can never duplicate.
--
-- The occurrence math itself lives in TypeScript (src/lib/recurrence.ts) and
-- runs from /api/cron/generate-visits. It is deliberately NOT duplicated in
-- SQL: one source of truth, fully unit-tested. The database's job here is to
-- make a buggy or double-fired run harmless.
--
-- RECURRENCE SEMANTICS (derived strictly from the existing schema — the only
-- temporal fields a schedule has are day_of_week + frequency):
--   weekly    every matching weekday on/after anchor_date
--   biweekly  every 2nd matching weekday, counted from anchor_date
--   monthly   the SAME ORDINAL weekday each month as anchor_date
--             (anchor is the 2nd Sunday -> every month's 2nd Sunday).
--             A month without that ordinal (e.g. no 5th Sunday) is SKIPPED,
--             never shifted to month-end.
--   NOTE: "same day-of-month" recurrence is NOT representable — `schedules`
--   has no day-of-month column — so day 29/30/31 edge cases do not arise.
--
-- TIMEZONE: visits.scheduled_date is a DATE. All generation is done in
-- Asia/Riyadh calendar dates (UTC+3, no DST). See recurrence.ts.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── A: visits → schedules link ────────────────────────────────────────────────
--
-- ON DELETE SET NULL (never CASCADE): deleting a planning rule must not erase
-- operational history. A generated visit whose schedule is deleted simply
-- becomes indistinguishable from a manual visit and is fully preserved.

alter table public.visits
  add column if not exists schedule_id uuid
    references public.schedules (id) on delete set null;

comment on column public.visits.schedule_id is
  'Source recurring schedule. NULL = manually created visit. ON DELETE SET NULL: schedule removal never deletes visit history.';

-- ── B: THE idempotency guarantee ──────────────────────────────────────────────
--
-- One visit per (schedule, date). Partial so the unlimited manual visits
-- (schedule_id IS NULL) are unaffected. The generator inserts with
-- ON CONFLICT DO NOTHING, so re-running — hourly, after a deploy, after a
-- retry — is a no-op for occurrences that already exist.
--
-- Safe because `schedules` is unique on (company, merch, place, day_of_week)
-- and carries a single start_time: one schedule can only mean one visit per
-- calendar date.
--
-- Created CONCURRENTLY is not possible inside a migration transaction, so a
-- duplicate pre-check keeps this safe on databases that somehow already have
-- generated rows.
do $$
begin
  if exists (
    select 1 from public.visits
    where schedule_id is not null
    group by schedule_id, scheduled_date
    having count(*) > 1
  ) then
    raise notice
      '[019] SKIPPED uq_visits_schedule_occurrence: duplicate (schedule_id, scheduled_date) rows exist. '
      'De-duplicate, then create the index manually — generation is NOT idempotent until it exists.';
  else
    create unique index if not exists uq_visits_schedule_occurrence
      on public.visits (schedule_id, scheduled_date)
      where schedule_id is not null;
    raise notice '[019] OK: uq_visits_schedule_occurrence created.';
  end if;
end;
$$;

-- Lookup support: "which visits came from this schedule / does this occurrence
-- already exist" and the generator's existing-occurrence pre-read.
create index if not exists idx_visits_schedule
  on public.visits (schedule_id)
  where schedule_id is not null;

-- ── C: recurrence anchor ──────────────────────────────────────────────────────
--
-- `schedules` had no start/anchor date — only created_at. Biweekly and monthly
-- are undefined without a stable anchor ("every other matching weekday from
-- today" would drift on every run), so the minimal explicit field is added.
--
-- Backfill is deterministic: the schedule's creation date in RIYADH local time,
-- rolled FORWARD to the first matching day_of_week. Re-running the migration
-- cannot change an already-set anchor.

alter table public.schedules
  add column if not exists anchor_date date;

comment on column public.schedules.anchor_date is
  'First occurrence date; the stable origin for biweekly parity and monthly weekday-ordinal. Backfilled from created_at (Asia/Riyadh), rolled forward to the first matching day_of_week.';

update public.schedules s
set anchor_date = (
  -- created_at as a Riyadh calendar date …
  with base as (
    select (s.created_at at time zone 'Asia/Riyadh')::date as d
  )
  -- … advanced to the next matching weekday (0 = Sunday, matching the
  -- day_of_week enum and the product's day labels).
  select b.d + ((s.day_of_week::text::int - extract(dow from b.d)::int + 7) % 7)
  from base b
)
where s.anchor_date is null;

-- New schedules get an anchor automatically, so the app's insert path
-- (services/schedules.ts) needs no change and can never create an
-- anchor-less rule.
create or replace function public.set_schedule_anchor()
returns trigger
language plpgsql
as $$
declare
  v_today date;
begin
  if new.anchor_date is null then
    v_today := (now() at time zone 'Asia/Riyadh')::date;
    new.anchor_date :=
      v_today + ((new.day_of_week::int - extract(dow from v_today)::int + 7) % 7);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_schedule_anchor on public.schedules;
create trigger trg_set_schedule_anchor
  before insert on public.schedules
  for each row
  execute function public.set_schedule_anchor();

-- Generator scan: active schedules only, bounded per company.
create index if not exists idx_schedules_active
  on public.schedules (company_id, day_of_week)
  where is_active;

-- ── D: audit — mark generated visits distinctly ───────────────────────────────
--
-- Extends the existing trigger from 012 rather than adding a second audit
-- path. Manual visits keep emitting exactly 'visit.created' as before; only
-- the generated branch and the extra details key are new. The generator runs
-- without a session, so resolve_audit_actor() returns NULL and the entry is
-- attributed to "system" — which is correct.

create or replace function public.log_visit_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action      text;
  v_actor_id    uuid;
  v_actor_name  text;
  v_place_name  text;
begin
  begin  -- logging must never break the visit write
    if tg_op = 'UPDATE' and new.status is distinct from old.status then
      v_action := case new.status
        when 'inprogress' then 'visit.started'
        when 'completed'  then 'visit.completed'
        when 'missed'     then 'visit.missed'
        else null
      end;
    elsif tg_op = 'INSERT' then
      -- NEW in 019: distinguish schedule-generated visits from manual ones.
      v_action := case
        when new.schedule_id is not null then 'visit.generated_from_schedule'
        else 'visit.created'
      end;
    end if;

    if v_action is not null then
      select ra.actor_id, ra.actor_name
      into   v_actor_id, v_actor_name
      from   resolve_audit_actor(new.company_id) ra;

      select coalesce(p.branch_en, p.branch_ar)
      into   v_place_name
      from   places p
      where  p.id = new.place_id;

      insert into activity_logs
        (company_id, actor_id, actor_name, action, entity_type, entity_id, entity_label, details)
      values
        (new.company_id, v_actor_id, v_actor_name, v_action, 'visit', new.id, v_place_name,
         jsonb_build_object(
           'status',         new.status,
           'scheduled_date', new.scheduled_date,
           'merch_id',       new.merch_id,
           'schedule_id',    new.schedule_id   -- NULL for manual visits
         ));
    end if;
  exception when others then
    null;  -- swallow all logging errors
  end;

  return new;
end;
$$;

-- Trigger definition itself is unchanged (012 already binds this function to
-- AFTER INSERT OR UPDATE ON visits); re-created here only for idempotency.
drop trigger if exists trg_log_visit_activity on public.visits;
create trigger trg_log_visit_activity
  after insert or update on public.visits
  for each row
  execute function public.log_visit_activity();

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: intentionally UNCHANGED.
--   • visits_insert still requires owner/admin — no user gained any right.
--   • Generated visits are ordinary rows: read/updated through the exact same
--     visit policies (merchandisers see their own, owner/admin see all).
--   • The generator does not run as a user. It authenticates with the
--     service-role key inside /api/cron/generate-visits (server-only, never
--     shipped to the browser), which bypasses RLS the same way the existing
--     invite-link route does.
-- ─────────────────────────────────────────────────────────────────────────────
