-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 011: Company-users enhancements
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Adds five new columns to company_users:
--
--   display_name    — cached copy of users.full_name;  survives auth-user deletion
--   display_email   — cached copy of users.email;      survives auth-user deletion
--   avatar_url      — company-level avatar override (signed Supabase Storage URL)
--   last_mobile_sync— timestamp updated by the mobile app on every sync
--   last_activity_at— denormalised "last visit action" for the users list
--
-- All columns are nullable so the migration is safe on existing data.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── A: Cached display info ────────────────────────────────────────────────────

alter table company_users
  add column if not exists display_name  text,
  add column if not exists display_email text;

-- Backfill from existing user records (idempotent)
update company_users cu
set
  display_name  = coalesce(cu.display_name,  u.full_name),
  display_email = coalesce(cu.display_email, u.email)
from users u
where cu.user_id = u.id
  and (cu.display_name is null or cu.display_email is null);

-- Trigger: auto-populate on INSERT so display info is always available
create or replace function sync_company_user_display()
returns trigger language plpgsql security definer as $$
declare
  v_name  text;
  v_email text;
begin
  select full_name, email
  into   v_name, v_email
  from   users
  where  id = new.user_id;

  -- Only set if not explicitly provided (lets admins override)
  if new.display_name  is null then new.display_name  := v_name;  end if;
  if new.display_email is null then new.display_email := v_email; end if;
  return new;
end;
$$;

drop trigger if exists trg_company_user_display_sync on company_users;
create trigger trg_company_user_display_sync
  before insert
  on company_users
  for each row
  execute function sync_company_user_display();

-- ── B: Company-level avatar override ─────────────────────────────────────────

alter table company_users
  add column if not exists avatar_url text;

-- ── C: Mobile sync timestamp (updated by mobile client on sync) ───────────────

alter table company_users
  add column if not exists last_mobile_sync timestamptz;

-- ── D: Latest activity (denormalised from visits) ────────────────────────────

alter table company_users
  add column if not exists last_activity_at timestamptz;

-- Index for fast "most-recently-active" queries
create index if not exists idx_company_users_last_activity
  on company_users (last_activity_at desc nulls last);

-- Backfill: set last_activity_at from the most recent visit per merchandiser
update company_users cu
set last_activity_at = (
  select max(v.updated_at)
  from   visits v
  where  v.merch_id = cu.id
)
where last_activity_at is null;

-- Trigger: keep last_activity_at up to date whenever a visit is touched
create or replace function update_merch_last_activity()
returns trigger language plpgsql security definer as $$
begin
  update company_users
  set    last_activity_at = greatest(
           coalesce(last_activity_at, '-infinity'::timestamptz),
           new.updated_at
         )
  where  id = new.merch_id;
  return new;
end;
$$;

drop trigger if exists trg_visit_merch_activity on visits;
create trigger trg_visit_merch_activity
  after insert or update on visits
  for each row
  execute function update_merch_last_activity();
