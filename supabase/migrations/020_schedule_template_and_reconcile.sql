-- ─────────────────────────────────────────────────────────────────────────────
-- 020 — Schedule templates + safe reconciliation of generated visits
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Follow-up to 019. Two additions:
--
--   1. schedules.template_id — so generated visits can carry a checklist
--      instead of always landing with template_id = NULL.
--
--   2. v_untouched_generated_visits — the AUTHORITATIVE definition of which
--      generated visits are safe to delete when a schedule is edited. The
--      generator may only ever delete ids that appear in this view, so the
--      "never touch operational data" rule is enforced by the database and
--      cannot be weakened by an application bug.
--
-- template_id is NULLABLE on purpose. The product explicitly supports
-- template-less visits:
--   • VisitCreateModal declares `template_id: z.string().optional()`
--   • visits/[id] renders the template block only `{templateId && template}`
--     and otherwise proceeds straight to the product checklist
-- Making it NOT NULL would contradict the manual flow and break every
-- existing schedule. Missing templates are surfaced (UI warning + generator
-- summary counter), never silently hidden.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── A: schedules → templates ──────────────────────────────────────────────────
--
-- ON DELETE SET NULL mirrors visits.template_id (001): deleting a template
-- must not delete planning rules or visit history.

alter table public.schedules
  add column if not exists template_id uuid
    references public.templates (id) on delete set null;

comment on column public.schedules.template_id is
  'Checklist template applied to visits generated from this schedule. NULL = generated visits carry no template (supported: see visits/[id]). Surfaced as a warning in the UI, never silently ignored.';

-- Generator reads active schedules and needs the template in the same scan.
create index if not exists idx_schedules_template
  on public.schedules (template_id)
  where template_id is not null;

-- ── B: THE untouched-visit gate ───────────────────────────────────────────────
--
-- A generated visit is "genuinely untouched" only when NOTHING operational has
-- happened to it. Every clause below protects a real signal of field work:
--
--   schedule_id is not null   only generated visits are ever reconciled;
--                             manual visits are out of scope entirely
--   status = 'pending'        never started / completed / missed
--   started_at is null        never opened in the field
--   completed_at is null      never finished
--   duration_minutes = 0      no recorded work time
--   notes is null             no manager/merchandiser note
--   checkin_* all empty       no GPS check-in evidence (009)
--   no visit_products rows    no product audit captured
--   no visit_template_responses rows
--                             no checklist answer captured
--
-- Date scoping (scheduled_date > today) is applied by the CALLER, because
-- "today" is a Riyadh calendar date the app computes; the view stays
-- date-agnostic so it can also be used for inspection/reporting.
--
-- SECURITY: a plain view inherits the RLS of its base tables for normal
-- callers. The generator queries it with the service-role key, exactly as it
-- does `visits` — no new privilege surface is introduced.

create or replace view public.v_untouched_generated_visits as
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
  'Generated visits with zero operational footprint — the ONLY rows reconciliation may delete or re-template. Anything started, completed, missed, noted, checked-in, product-audited or checklist-answered is excluded by construction.';

-- Supports the not-exists probes above at scale.
create index if not exists idx_visit_products_visit
  on public.visit_products (visit_id);

create index if not exists idx_vtr_visit_lookup
  on public.visit_template_responses (visit_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: unchanged. No policy is added, altered or relaxed. Reconciliation
-- deletes run through the generator's service-role client (server-only), the
-- same mechanism 019 already uses for inserts.
-- ─────────────────────────────────────────────────────────────────────────────
