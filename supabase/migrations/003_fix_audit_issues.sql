-- ============================================================
-- Malgoof SaaS — Migration 003: Lightweight Audit Patch
-- ============================================================
-- Run strictly after 001 → 002. Touches no tables or data.
-- Fixes two audit issues that belong at the function/policy
-- level and cannot change the outcome of migration 002:
--
--   M1  SET search_path on all SECURITY DEFINER functions.
--   M2  Explicit WITH CHECK on visit_products_update policy.
--
-- Constraint changes (H1) were moved directly into migration
-- 002 Section 4 so they cannot be blocked by a prior failure.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- SECTION 1: Fix M1 — SET search_path on SECURITY DEFINER
-- ────────────────────────────────────────────────────────────
-- Why this matters:
--   SECURITY DEFINER functions run with the owner's privileges
--   (typically the postgres superuser), not the calling user's.
--   Without a fixed search_path a malicious database user could
--   CREATE an object in a schema that appears earlier in the
--   default search_path (e.g. pg_temp) and redirect the function
--   to attacker-controlled tables — a search-path injection
--   ("trojan horse") attack. SET search_path = public locks
--   name resolution to the public schema only.
--
-- Three functions need patching across the two prior migrations:
--   • get_my_company_ids()      — originally in migration 001
--   • get_my_role()             — originally in migration 001
--   • get_my_company_user_ids() — originally in migration 002
-- Note: handle_new_user() already has SET search_path in 002.

CREATE OR REPLACE FUNCTION get_my_company_ids()
RETURNS UUID[] AS $$
  SELECT ARRAY(
    SELECT company_id
    FROM   company_users
    WHERE  user_id = auth.uid()
    AND    status  = 'active'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

CREATE OR REPLACE FUNCTION get_my_role(p_company_id UUID)
RETURNS user_role AS $$
  SELECT role
  FROM   company_users
  WHERE  user_id    = auth.uid()
  AND    company_id = p_company_id
  AND    status     = 'active'
  LIMIT  1;
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

CREATE OR REPLACE FUNCTION get_my_company_user_ids()
RETURNS UUID[] AS $$
  SELECT ARRAY(
    SELECT id
    FROM   company_users
    WHERE  user_id = auth.uid()
    AND    status  = 'active'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;


-- ────────────────────────────────────────────────────────────
-- SECTION 2: Fix M2 — Explicit WITH CHECK on visit_products_update
-- ────────────────────────────────────────────────────────────
-- PostgreSQL defaults the WITH CHECK expression to the USING
-- expression when WITH CHECK is omitted on an UPDATE policy,
-- so the policy created in migration 002 was functionally safe.
-- This patch makes the intent explicit for three reasons:
--   1. Consistency with every other UPDATE policy in this codebase.
--   2. Prevents a future reader from assuming the omission was
--      intentional and removing the USING guard.
--   3. Guards against any PostgreSQL version that changes the
--      defaulting behaviour.

DROP POLICY IF EXISTS "visit_products_update" ON visit_products;

CREATE POLICY "visit_products_update" ON visit_products
  FOR UPDATE
  -- USING  : which existing rows the caller may target.
  USING (
    visit_id IN (
      SELECT id FROM visits
      WHERE  company_id = ANY(get_my_company_ids())
      AND (
        get_my_role(company_id) IN ('owner','admin')
        OR merch_id = ANY(get_my_company_user_ids())
      )
    )
  )
  -- WITH CHECK : what the row must look like after the update.
  -- Mirrors USING to prevent moving a record to an out-of-scope
  -- visit (e.g. reassigning visit_id to another company's visit).
  WITH CHECK (
    visit_id IN (
      SELECT id FROM visits
      WHERE  company_id = ANY(get_my_company_ids())
      AND (
        get_my_role(company_id) IN ('owner','admin')
        OR merch_id = ANY(get_my_company_user_ids())
      )
    )
  );
