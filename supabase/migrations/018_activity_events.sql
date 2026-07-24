-- ─────────────────────────────────────────────────────────────────────────────
-- 018 — Activity event stream (Mobile/docs/event-system.md).
--
-- CLIENT-observed events (photos, barcode, sync, notifications, auth, AI,
-- visit lifecycle as seen on-device with trace/offline context). This
-- COMPLEMENTS activity_logs (012): activity_logs stays the server-
-- authoritative audit of visit transitions (trigger-written); this table
-- is the best-effort telemetry/timeline stream. Two streams, two
-- guarantees — documented in the mobile repo.
--
-- IMMUTABILITY: insert + select only. No UPDATE/DELETE policies exist and
-- both verbs are revoked from `authenticated` — clients (and compromised
-- tokens) cannot rewrite history.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.activity_events (
  -- Client-generated UUID: makes buffered replays idempotent upserts.
  id           uuid primary key,
  company_id   uuid not null references public.companies (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  visit_id     uuid references public.visits (id) on delete set null,
  entity_type  text not null default 'none',
  entity_id    uuid,
  event_type   text not null check (char_length(event_type) between 3 and 60),
  priority     text not null default 'normal'
               check (priority in ('low', 'normal', 'high', 'urgent')),
  metadata     jsonb not null default '{}'::jsonb
               check (pg_column_size(metadata) <= 8192),
  source       text not null default 'mobile'
               check (source in ('mobile', 'web', 'server')),
  trace_id     uuid,
  offline      boolean not null default false,
  created_at   timestamptz not null default now()
);

comment on table public.activity_events is
  'Client-observed event stream (timeline/AI-context/telemetry). Immutable; complements activity_logs (the server-authoritative audit).';

create index if not exists activity_events_company_created_idx
  on public.activity_events (company_id, created_at desc);
create index if not exists activity_events_user_created_idx
  on public.activity_events (user_id, created_at desc);
create index if not exists activity_events_visit_idx
  on public.activity_events (visit_id)
  where visit_id is not null;
create index if not exists activity_events_type_idx
  on public.activity_events (event_type);

alter table public.activity_events enable row level security;

-- Read: any ACTIVE member of the row's company (company activity feed —
-- the same visibility model as activity_logs).
create policy activity_events_select_company
  on public.activity_events for select
  using (
    company_id in (
      select company_id from public.company_users
      where user_id = auth.uid() and status = 'active'
    )
  );

-- Insert: only as YOURSELF into a company you actively belong to. The
-- client fills user_id/company_id, but RLS re-derives the truth — event
-- injection under another identity or tenant is structurally impossible.
create policy activity_events_insert_own
  on public.activity_events for insert
  with check (
    user_id = auth.uid()
    and company_id in (
      select company_id from public.company_users
      where user_id = auth.uid() and status = 'active'
    )
  );

-- Immutable: no update/delete policies, and belt-and-braces revokes.
revoke update, delete on public.activity_events from authenticated;

-- ── Retention strategy ───────────────────────────────────────────────────────
-- Telemetry has bounded value: keep 90 days. Schedule server-side (do NOT
-- give clients delete rights). With pg_cron enabled:
--
--   select cron.schedule(
--     'purge_activity_events', '20 3 * * *',
--     $$delete from public.activity_events
--       where created_at < now() - interval '90 days'$$
--   );
--
-- Without pg_cron, run the same DELETE from a scheduled Edge Function.
-- activity_events_company_created_idx makes the purge cheap.
