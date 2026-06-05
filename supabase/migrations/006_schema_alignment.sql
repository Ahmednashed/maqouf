-- ============================================================
-- Migration 006 — Schema Alignment
-- ============================================================
-- WHY THIS MIGRATION IS NEEDED
-- ─────────────────────────────
-- Migration 001 created `place_products` with only three
-- columns (place_id, product_id, created_at).  The application
-- code in src/services/place-products.ts inserts and updates
-- four additional operational columns on every write:
--
--   • is_mandatory      — whether the product must be present
--   • min_stock         — minimum acceptable shelf quantity
--   • display_priority  — ordering for the field app UI
--   • is_active         — soft-delete / deactivation flag
--
-- Without these columns every call to assignPlaceProduct() or
-- updatePlaceProduct() fails at the database level with a
-- "column does not exist" error.
--
-- Similarly, migration 001 created `schedules` without a
-- `frequency` column.  src/services/schedules.ts passes
-- frequency ("weekly" | "biweekly" | "monthly") in every
-- createSchedule() call, so all schedule creation fails.
--
-- This migration adds the missing columns and supporting
-- indexes.  All changes are fully idempotent: the migration
-- is safe to run on a database that already has some or all
-- of these objects.
-- ============================================================

-- ── 1. place_products — add missing operational columns ──────

ALTER TABLE place_products
  ADD COLUMN IF NOT EXISTS is_mandatory     BOOLEAN  NOT NULL DEFAULT false;

ALTER TABLE place_products
  ADD COLUMN IF NOT EXISTS min_stock        INTEGER  NOT NULL DEFAULT 0;

ALTER TABLE place_products
  ADD COLUMN IF NOT EXISTS display_priority INTEGER  NOT NULL DEFAULT 0;

ALTER TABLE place_products
  ADD COLUMN IF NOT EXISTS is_active        BOOLEAN  NOT NULL DEFAULT true;

-- ── 2. schedules — add frequency column + check constraint ───

ALTER TABLE schedules
  ADD COLUMN IF NOT EXISTS frequency TEXT NOT NULL DEFAULT 'weekly';

-- Drop the check constraint if it already exists (re-running
-- the migration must not error on a duplicate constraint name).
ALTER TABLE schedules
  DROP CONSTRAINT IF EXISTS schedules_frequency_check;

-- NOT VALID skips a full-table scan for existing rows that
-- already satisfy the default 'weekly' value.
ALTER TABLE schedules
  ADD CONSTRAINT schedules_frequency_check
  CHECK (frequency IN ('weekly', 'biweekly', 'monthly'))
  NOT VALID;

-- ── 3. New indexes ───────────────────────────────────────────
-- Existing indexes from 002 (NOT duplicated here):
--   idx_place_products_place    ON place_products(place_id)
--   idx_place_products_product  ON place_products(product_id)

-- Filter active assortment for a given branch efficiently.
CREATE INDEX IF NOT EXISTS idx_place_products_place_active
  ON place_products (place_id, is_active);

-- Return assortment in display order without a sort step.
CREATE INDEX IF NOT EXISTS idx_place_products_place_priority
  ON place_products (place_id, display_priority);

-- Schedule lookups by company + merch + weekday (RLS + queries).
CREATE INDEX IF NOT EXISTS idx_schedules_company_merch_day
  ON schedules (company_id, merch_id, day_of_week);

-- Schedule lookups by company + branch + weekday.
CREATE INDEX IF NOT EXISTS idx_schedules_company_place_day
  ON schedules (company_id, place_id, day_of_week);
