-- ============================================================
-- Malgoof SaaS — Migration 004: Add template_fields table
-- ============================================================
-- The templates engine stores each field as a separate row in
-- template_fields (relational) rather than in the JSONB `fields`
-- column on the templates table. This enables:
--   • per-field RLS and audit trails
--   • efficient single-field updates/deletes without rewriting the
--     whole JSONB blob
--   • standard sort_order-based reordering
--
-- Run after migrations 001 → 002 → 003.
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- TABLE
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS template_fields (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_id  UUID        NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  company_id   UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- field definition
  type         TEXT        NOT NULL,          -- e.g. 'text','numeric','yesno','single',…
  label_ar     TEXT        NOT NULL DEFAULT '',
  label_en     TEXT        NOT NULL DEFAULT '',
  required     BOOLEAN     NOT NULL DEFAULT FALSE,
  sort_order   INT         NOT NULL DEFAULT 0,
  options      JSONB,                         -- array of option strings for single/multiple
  help_text_ar TEXT,
  help_text_en TEXT,
  -- timestamps
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ────────────────────────────────────────────────────────────
-- INDEXES
-- ────────────────────────────────────────────────────────────

-- Primary access pattern: all fields for a template, ordered
CREATE INDEX IF NOT EXISTS idx_template_fields_template
  ON template_fields (template_id, sort_order);

-- Company-scoped queries (used by some RLS policies)
CREATE INDEX IF NOT EXISTS idx_template_fields_company
  ON template_fields (company_id);


-- ────────────────────────────────────────────────────────────
-- UPDATED_AT TRIGGER
-- ────────────────────────────────────────────────────────────
-- Re-uses the update_updated_at() function created in migration 001.

DROP TRIGGER IF EXISTS set_updated_at ON template_fields;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON template_fields
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ────────────────────────────────────────────────────────────
-- ROW-LEVEL SECURITY
-- ────────────────────────────────────────────────────────────

ALTER TABLE template_fields ENABLE ROW LEVEL SECURITY;

-- Drop any stale policies so this migration is idempotent
DROP POLICY IF EXISTS "template_fields_select" ON template_fields;
DROP POLICY IF EXISTS "template_fields_insert" ON template_fields;
DROP POLICY IF EXISTS "template_fields_update" ON template_fields;
DROP POLICY IF EXISTS "template_fields_delete" ON template_fields;

-- All company members can read template fields (merchandisers
-- need them when filling out forms in the field).
CREATE POLICY "template_fields_select" ON template_fields
  FOR SELECT USING (
    company_id = ANY(get_my_company_ids())
  );

-- Only owner / admin can add fields to a template.
CREATE POLICY "template_fields_insert" ON template_fields
  FOR INSERT WITH CHECK (
    company_id = ANY(get_my_company_ids())
    AND get_my_role(company_id) IN ('owner', 'admin')
  );

-- Only owner / admin can edit field definitions.
CREATE POLICY "template_fields_update" ON template_fields
  FOR UPDATE
  USING (
    company_id = ANY(get_my_company_ids())
    AND get_my_role(company_id) IN ('owner', 'admin')
  )
  WITH CHECK (
    company_id = ANY(get_my_company_ids())
    AND get_my_role(company_id) IN ('owner', 'admin')
  );

-- Only owner / admin can remove fields.
CREATE POLICY "template_fields_delete" ON template_fields
  FOR DELETE USING (
    company_id = ANY(get_my_company_ids())
    AND get_my_role(company_id) IN ('owner', 'admin')
  );
