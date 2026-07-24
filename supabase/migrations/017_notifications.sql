-- ─────────────────────────────────────────────────────────────────────────────
-- 017 — Notification engine (mobile): inbox + device registry.
--
-- Design (Mobile/docs/notification-engine.md):
--   notifications          server-written inbox rows; clients may ONLY
--                          read their own rows and flip read_at.
--   notification_devices   Expo push tokens, one row per (user, token);
--                          fully owned by the user under RLS.
--
-- Inserts into `notifications` are SERVER-side only (service role or DB
-- triggers/functions — the push sender project). Authenticated clients get
-- no INSERT/DELETE, and UPDATE is column-restricted to read_at.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Inbox ────────────────────────────────────────────────────────────────────

create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  company_id   uuid not null references public.companies (id) on delete cascade,
  type         text not null,
  title        text not null,
  body         text not null default '',
  entity_type  text,
  entity_id    uuid,
  route        text,
  metadata     jsonb not null default '{}'::jsonb,
  priority     text not null default 'normal'
               check (priority in ('low', 'normal', 'high', 'urgent')),
  source       text not null default 'server'
               check (source in ('local', 'push', 'server')),
  read_at      timestamptz,
  expires_at   timestamptz,
  created_at   timestamptz not null default now()
);

comment on table public.notifications is
  'Per-user notification inbox. Written server-side; mobile reads + marks read.';

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_user_unread_idx
  on public.notifications (user_id)
  where read_at is null;

alter table public.notifications enable row level security;

-- Read own rows only, and only while an ACTIVE member of the row's company
-- (deactivation cuts the inbox exactly like every other surface).
create policy notifications_select_own
  on public.notifications for select
  using (
    user_id = auth.uid()
    and company_id in (
      select company_id from public.company_users
      where user_id = auth.uid() and status = 'active'
    )
  );

-- Clients may update OWN rows; the column grant below narrows this to
-- read_at (RLS rows × column privileges = "mark read" and nothing else).
create policy notifications_update_own
  on public.notifications for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke insert, delete on public.notifications from authenticated;
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- ── Device registry ──────────────────────────────────────────────────────────

create table if not exists public.notification_devices (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users (id) on delete cascade,
  company_id             uuid not null references public.companies (id) on delete cascade,
  expo_push_token        text not null,
  platform               text not null,
  device_name            text,
  app_version            text,
  locale                 text not null default 'en',
  timezone               text not null default 'UTC',
  notifications_enabled  boolean not null default true,
  last_seen_at           timestamptz not null default now(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (user_id, expo_push_token)
);

comment on table public.notification_devices is
  'Expo push tokens per user/device. The push sender selects enabled rows; users own their rows under RLS.';

create index if not exists notification_devices_user_idx
  on public.notification_devices (user_id);

alter table public.notification_devices enable row level security;

create policy notification_devices_select_own
  on public.notification_devices for select
  using (user_id = auth.uid());

-- Insert only for yourself, into a company you are an active member of —
-- the client can never plant a token under another user or tenant.
create policy notification_devices_insert_own
  on public.notification_devices for insert
  with check (
    user_id = auth.uid()
    and company_id in (
      select company_id from public.company_users
      where user_id = auth.uid() and status = 'active'
    )
  );

create policy notification_devices_update_own
  on public.notification_devices for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy notification_devices_delete_own
  on public.notification_devices for delete
  using (user_id = auth.uid());
