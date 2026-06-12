-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 010: Soft-delete & orphaned-user safety
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Problem:  When a user is hard-deleted from auth.users the related
--           company_users row still exists.  The frontend joins on
--           user:users!company_users_user_id_fkey and gets user = null,
--           which crashed the app.
--
-- Strategy: Never hard-delete company_users rows.
--           Use the existing `status` column ('active' | 'inactive') as the
--           soft-delete flag.  Orphaned rows (user_id no longer in public.users)
--           are automatically set to 'inactive'.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Ensure `status` column exists (safe for existing installations)
alter table company_users
  add column if not exists status text not null default 'active'
  check (status in ('active', 'inactive'));

-- 2. Index for fast active-user lookups (already used in every dropdown query)
create index if not exists idx_company_users_status
  on company_users (status);

-- 3. Compound index for the most common query pattern (company + status)
create index if not exists idx_company_users_company_status
  on company_users (company_id, status);

-- 4. Mark orphaned rows as inactive
--    (company_users rows whose user_id has no matching row in public.users —
--     this happens when auth.users is hard-deleted outside the app)
update company_users
set status = 'inactive'
where status = 'active'
  and user_id not in (select id from users);

-- 5. Diagnostic query — run this manually in Supabase SQL editor to audit
--    the current state after the migration:
--
--    select
--      cu.id,
--      cu.user_id,
--      cu.status,
--      cu.role,
--      u.email,
--      u.full_name
--    from company_users cu
--    left join users u on u.id = cu.user_id
--    where cu.status = 'inactive'
--    order by cu.created_at;
