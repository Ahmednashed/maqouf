-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 012: Activity & Audit System
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Adds an append-only activity_logs table capturing who did what, when,
-- to which entity — plus DB triggers that record visit lifecycle and
-- user-management events automatically (so mobile writes are logged too).
--
-- Design rules:
--   • Append-only: RLS grants SELECT + INSERT only. No UPDATE/DELETE
--     policies exist, so the log is immutable from any client.
--   • Never breaks the parent action: every trigger body is wrapped in
--     BEGIN … EXCEPTION WHEN OTHERS THEN NULL. A logging failure can
--     never abort a visit save or a user update.
--   • Actor snapshot: actor_name is cached at write time (same philosophy
--     as company_users.display_name in migration 011) so history stays
--     readable after a user is deleted.
--   • actor_id is nullable: service-role or mobile-sync writes where
--     auth.uid() is NULL are recorded as "system" events.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── A: Table ──────────────────────────────────────────────────────────────────

create table if not exists activity_logs (
  id           uuid primary key default uuid_generate_v4(),
  company_id   uuid not null references companies(id) on delete cascade,
  actor_id     uuid references company_users(id) on delete set null,
  actor_name   text,
  action       text not null,          -- e.g. 'visit.completed', 'user.deactivated'
  entity_type  text not null,          -- 'visit' | 'user' | 'place' | 'product' | ...
  entity_id    uuid,
  entity_label text,                   -- cached human-readable target name
  details      jsonb,                  -- old/new values, extra context
  created_at   timestamptz not null default now()
);

create index if not exists idx_activity_logs_company_created
  on activity_logs (company_id, created_at desc);

create index if not exists idx_activity_logs_entity
  on activity_logs (entity_type, entity_id);

create index if not exists idx_activity_logs_actor
  on activity_logs (actor_id);

-- ── B: RLS — SELECT + INSERT only (immutable log) ─────────────────────────────

alter table activity_logs enable row level security;

drop policy if exists activity_logs_select on activity_logs;
create policy activity_logs_select on activity_logs for select
  using (company_id = any(get_my_company_ids()));

drop policy if exists activity_logs_insert on activity_logs;
create policy activity_logs_insert on activity_logs for insert
  with check (company_id = any(get_my_company_ids()));

-- Deliberately NO update/delete policies: log rows cannot be altered
-- or removed by any authenticated client.

-- ── C: Helper — resolve the acting company_users row from auth.uid() ─────────

create or replace function resolve_audit_actor(p_company_id uuid)
returns table (actor_id uuid, actor_name text)
language sql
security definer
set search_path = public
stable
as $$
  select cu.id,
         coalesce(cu.display_name, u.full_name)
  from   company_users cu
  left join users u on u.id = cu.user_id
  where  cu.user_id    = auth.uid()
    and  cu.company_id = p_company_id
  limit 1;
$$;

-- ── D: Trigger — visit lifecycle events ───────────────────────────────────────
--
-- Fires on status transitions only (pending→inprogress→completed/missed).
-- Entity label = place name so feed items read naturally.

create or replace function log_visit_activity()
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
      v_action := 'visit.created';
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
           'merch_id',       new.merch_id
         ));
    end if;
  exception when others then
    null;  -- swallow all logging errors
  end;

  return new;
end;
$$;

drop trigger if exists trg_log_visit_activity on visits;
create trigger trg_log_visit_activity
  after insert or update on visits
  for each row
  execute function log_visit_activity();

-- ── E: Trigger — user management events ───────────────────────────────────────
--
-- Fires when status or role changes on company_users.
-- Entity label = the affected member's display name.

create or replace function log_company_user_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action      text;
  v_actor_id    uuid;
  v_actor_name  text;
  v_target_name text;
  v_details     jsonb;
begin
  begin  -- logging must never break the user update
    if new.status is distinct from old.status then
      v_action  := case new.status
        when 'active'   then 'user.activated'
        when 'inactive' then 'user.deactivated'
      end;
      v_details := jsonb_build_object('old_status', old.status, 'new_status', new.status);
    elsif new.role is distinct from old.role then
      v_action  := 'user.role_changed';
      v_details := jsonb_build_object('old_role', old.role, 'new_role', new.role);
    end if;

    if v_action is not null then
      select ra.actor_id, ra.actor_name
      into   v_actor_id, v_actor_name
      from   resolve_audit_actor(new.company_id) ra;

      select coalesce(cu.display_name, u.full_name)
      into   v_target_name
      from   company_users cu
      left join users u on u.id = cu.user_id
      where  cu.id = new.id;

      insert into activity_logs
        (company_id, actor_id, actor_name, action, entity_type, entity_id, entity_label, details)
      values
        (new.company_id, v_actor_id, v_actor_name, v_action, 'user', new.id, v_target_name, v_details);
    end if;
  exception when others then
    null;  -- swallow all logging errors
  end;

  return new;
end;
$$;

drop trigger if exists trg_log_company_user_activity on company_users;
create trigger trg_log_company_user_activity
  after update on company_users
  for each row
  execute function log_company_user_activity();
