-- ============================================================
-- Migration 009 — Visit GPS Check-in Columns
-- ============================================================
-- Adds GPS evidence columns to the visits table so that:
--   • The service layer can persist the merchandiser's
--     physical location at check-in time.
--   • Distance to the branch is stored for audit / analytics.
--   • checkin_verified flags that the GPS check was passed.
--
-- All columns are nullable — existing visits and visits where
-- the branch has no configured coordinates will have NULL
-- values here (no breakage).
--
-- Future-ready: commented columns below document the intended
-- shape for checkout GPS, route tracking, and anti-spoof flags
-- so future migrations extend rather than redesign this table.
--
-- Safe to re-run: uses ADD COLUMN IF NOT EXISTS throughout.
-- ============================================================


-- ── Check-in GPS (captured when merchandiser taps "Start") ───

ALTER TABLE visits
  ADD COLUMN IF NOT EXISTS checkin_lat              DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS checkin_lng              DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS checkin_accuracy         DOUBLE PRECISION,  -- device-reported GPS accuracy (metres)
  ADD COLUMN IF NOT EXISTS checkin_distance_meters  DOUBLE PRECISION,  -- Haversine distance to branch at check-in
  ADD COLUMN IF NOT EXISTS checkin_verified         BOOLEAN NOT NULL DEFAULT FALSE;
  -- TRUE  → GPS captured, distance ≤ 200 m, saved by service layer
  -- FALSE → visit started without GPS (branch has no coordinates, or
  --          merchandiser explicitly bypassed with admin approval)


-- ── Index: useful for analytics queries that filter on verified check-ins ──

CREATE INDEX IF NOT EXISTS idx_visits_checkin_verified
  ON visits (company_id, checkin_verified)
  WHERE checkin_verified = TRUE;


-- ── Future columns (DO NOT ADD YET — reserved for later migrations) ──────────
--
-- Checkout GPS (when merchandiser taps "Complete Visit"):
--   checkout_lat              DOUBLE PRECISION,
--   checkout_lng              DOUBLE PRECISION,
--   checkout_accuracy         DOUBLE PRECISION,
--   checkout_distance_meters  DOUBLE PRECISION,
--
-- Route tracking (background position log):
--   route_points  JSONB NOT NULL DEFAULT '[]',
--   -- shape: [{ lat, lng, accuracy, ts }]
--
-- Anti-spoofing / fake GPS detection flags:
--   gps_flags  JSONB NOT NULL DEFAULT '{}',
--   -- shape: { mock_location: bool, altitude_anomaly: bool, ... }
--
-- Reason they are commented: each requires its own migration with
-- matching frontend / Edge Function changes. Listing them here keeps
-- the overall GPS architecture visible in one place.
