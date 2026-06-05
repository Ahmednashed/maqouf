-- ============================================================
-- Malgoof SaaS — Migration 005: visit_template_responses
-- ============================================================
-- Stores one JSONB value per template field per visit.
-- Mirrors the visit_products access pattern for RLS:
--   • owner / admin : read & write all company responses
--   • merchandiser  : read & write only their assigned visits
--
-- Run after migrations 001 → 002 → 003 → 004.
-- Safe to re-run: uses IF NOT EXISTS and DROP … IF EXISTS.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- TABLE
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS visit_template_responses (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  visit_id    UUID        NOT NULL REFERENCES visits(id)          ON DELETE CASCADE,
  template_id UUID        NOT NULL REFERENCES templates(id)       ON DELETE CASCADE,
  field_id    UUID        NOT NULL REFERENCES template_fields(id) ON DELETE CASCADE,
  value       JSONB,                    -- typed by field.type: string | number | boolean | string[] | object
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Enforce one response per field per visit
  UNIQUE (visit_id, field_id)
);


-- ────────────────────────────────────────────────────────────
-- INDEXES
-- ────────────────────────────────────────────────────────────

-- Primary read pattern: all responses for a visit
CREATE INDEX IF NOT EXISTS idx_vtr_visit
  ON visit_template_responses (visit_id);

-- Secondary: all responses for a specific field (reporting)
CREATE INDEX IF NOT EXISTS idx_vtr_field
  ON visit_template_responses (field_id);


-- ────────────────────────────────────────────────────────────
-- UPDATED_AT TRIGGER
-- ────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS set_updated_at ON visit_template_responses;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON visit_template_responses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ────────────────────────────────────────────────────────────
-- ROW-LEVEL SECURITY
-- ────────────────────────────────────────────────────────────

ALTER TABLE visit_template_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vtr_select" ON visit_template_responses;
DROP POLICY IF EXISTS "vtr_insert" ON visit_template_responses;
DROP POLICY IF EXISTS "vtr_update" ON visit_template_responses;
DROP POLICY IF EXISTS "vtr_delete" ON visit_template_responses;

-- SELECT — any company member may read responses for company visits
CREATE POLICY "vtr_select" ON visit_template_responses
  FOR SELECT USING (
    visit_id IN (
      SELECT id FROM visits
      WHERE  company_id = ANY(get_my_company_ids())
    )
  );

-- INSERT — owner/admin for any visit; merchandiser for their own
CREATE POLICY "vtr_insert" ON visit_template_responses
  FOR INSERT WITH CHECK (
    visit_id IN (
      SELECT id FROM visits
      WHERE  company_id = ANY(get_my_company_ids())
      AND (
        get_my_role(company_id) IN ('owner', 'admin')
        OR merch_id = ANY(get_my_company_user_ids())
      )
    )
  );

-- UPDATE — same access pattern as INSERT
CREATE POLICY "vtr_update" ON visit_template_responses
  FOR UPDATE
  USING (
    visit_id IN (
      SELECT id FROM visits
      WHERE  company_id = ANY(get_my_company_ids())
      AND (
        get_my_role(company_id) IN ('owner', 'admin')
        OR merch_id = ANY(get_my_company_user_ids())
      )
    )
  )
  WITH CHECK (
    visit_id IN (
      SELECT id FROM visits
      WHERE  company_id = ANY(get_my_company_ids())
      AND (
        get_my_role(company_id) IN ('owner', 'admin')
        OR merch_id = ANY(get_my_company_user_ids())
      )
    )
  );

-- DELETE — owner / admin only
CREATE POLICY "vtr_delete" ON visit_template_responses
  FOR DELETE USING (
    visit_id IN (
      SELECT id FROM visits
      WHERE  company_id = ANY(get_my_company_ids())
      AND    get_my_role(company_id) IN ('owner', 'admin')
    )
  );
