-- ─────────────────────────────────────────────────────────────────────────────
-- 021 — Make v_untouched_generated_visits respect the CALLER's RLS
-- ─────────────────────────────────────────────────────────────────────────────
--
-- SECURITY FIX for the view added in 020.
--
-- PostgreSQL views default to `security_invoker = false`, which means the view
-- body executes with the privileges of the view OWNER. The migration runner
-- owns this view (and the underlying `visits` table), and RLS is not enforced
-- for a table's owner — so ANY authenticated user selecting from the view
-- would have seen untouched generated visits belonging to EVERY company.
--
-- This was latent while only the service-role generator read the view (service
-- role bypasses RLS anyway). It becomes an active cross-tenant leak the moment
-- a user-session endpoint reads it — which is exactly what the per-schedule
-- reconcile endpoint does.
--
-- `security_invoker = true` (PG15+, which Supabase runs) makes the view
-- evaluate base-table RLS as the QUERYING user:
--   • owner/admin  → only their own company's visits (visits_select)
--   • merchandiser → only visits assigned to them
--   • service role → unchanged (bypasses RLS, as before)
--
-- 020 is left untouched, per the no-rewriting-old-migrations rule. This
-- migration is idempotent and safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace view public.v_untouched_generated_visits
with (security_invoker = true)
as
select
  v.id,
  v.company_id,
  v.schedule_id,
  v.scheduled_date,
  v.template_id
from public.visits v
where v.schedule_id      is not null
  and v.status            = 'pending'
  and v.started_at        is null
  and v.completed_at      is null
  and coalesce(v.duration_minutes, 0) = 0
  and v.notes             is null
  and coalesce(v.checkin_verified, false) = false
  and v.checkin_lat       is null
  and v.checkin_lng       is null
  and v.checkin_accuracy  is null
  and v.checkin_distance_meters is null
  and not exists (
    select 1 from public.visit_products vp where vp.visit_id = v.id
  )
  and not exists (
    select 1 from public.visit_template_responses r where r.visit_id = v.id
  );

comment on view public.v_untouched_generated_visits is
  'Generated visits with zero operational footprint — the ONLY rows reconciliation may delete or re-template. security_invoker=true: base-table RLS is evaluated as the querying user, so the view is tenant-safe for user sessions.';
