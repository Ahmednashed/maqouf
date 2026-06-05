-- ============================================================
-- Malgoof SaaS — Migration 002: Fix RLS, Signup Trigger,
--                               Indexes & Constraints
-- ============================================================
-- Safe to run on an existing database.
-- Uses IF EXISTS / ON CONFLICT / DROP ... IF EXISTS throughout.
-- Does NOT drop or truncate any data.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- SECTION 1: Helper — merchandiser identity lookup
-- ────────────────────────────────────────────────────────────
-- Returns the company_users.id values owned by the current auth
-- user across all companies they belong to (active memberships).
-- Used in visits / visit_products / expiring_products RLS to
-- check whether merch_id belongs to the current user.
CREATE OR REPLACE FUNCTION get_my_company_user_ids()
RETURNS UUID[] AS $$
  SELECT ARRAY(
    SELECT id
    FROM   company_users
    WHERE  user_id = auth.uid()
    AND    status  = 'active'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;


-- ────────────────────────────────────────────────────────────
-- SECTION 2: Signup auto-provisioning trigger
-- ────────────────────────────────────────────────────────────
-- Problem: supabase.auth.signUp() only creates auth.users.
-- Nothing in migration 001 creates public.users, companies,
-- or company_users records — leaving every new account broken.
--
-- Solution: an AFTER INSERT trigger on auth.users that runs
-- as SECURITY DEFINER (bypasses RLS) and atomically creates:
--   1. public.users profile
--   2. companies record  (slug derived from company_name metadata)
--   3. company_users record with role = 'owner'
--
-- Idempotency: ON CONFLICT DO NOTHING on users/company_users;
-- the slug uniqueness loop prevents duplicate company names.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public   -- prevents search_path injection
AS $$
DECLARE
  v_company_id   UUID;
  v_company_name TEXT;
  v_full_name    TEXT;
  v_phone        TEXT;
  v_base_slug    TEXT;
  v_slug         TEXT;
  v_counter      INT := 0;
BEGIN
  -- ── Pull values from Supabase Auth metadata ──────────────
  v_company_name := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data->>'company_name'), ''),
    'My Company'
  );
  v_full_name := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''),
    split_part(NEW.email, '@', 1)
  );
  v_phone := NULLIF(trim(NEW.raw_user_meta_data->>'phone'), '');

  -- ── Step 1: Create public user profile ───────────────────
  INSERT INTO public.users (id, email, full_name, phone, created_at, updated_at)
  VALUES (NEW.id, NEW.email, v_full_name, v_phone, NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;

  -- ── Step 2: Build a URL-safe slug from company_name ──────
  -- Strip non-ASCII (handles Arabic names), lowercase, collapse
  -- multiple hyphens, trim leading/trailing hyphens.
  v_base_slug := trim(both '-' from
    regexp_replace(
      lower(regexp_replace(v_company_name, '[^a-zA-Z0-9]+', '-', 'g')),
      '-{2,}', '-', 'g'
    )
  );

  -- Fallback: if company name is purely non-Latin (e.g. Arabic),
  -- derive slug from the email username instead.
  IF v_base_slug = '' OR length(v_base_slug) < 2 THEN
    v_base_slug := trim(both '-' from
      lower(regexp_replace(split_part(NEW.email, '@', 1), '[^a-z0-9]+', '-', 'g'))
    );
  END IF;

  -- Final safety net: guarantee minimum slug length.
  IF length(v_base_slug) < 2 THEN
    v_base_slug := 'co';
  END IF;

  -- Make slug unique by appending an incrementing counter.
  v_slug := v_base_slug;
  WHILE EXISTS (SELECT 1 FROM public.companies WHERE slug = v_slug) LOOP
    v_counter := v_counter + 1;
    v_slug    := v_base_slug || '-' || v_counter;
  END LOOP;

  -- ── Step 3: Create the company ───────────────────────────
  INSERT INTO public.companies (
    name, slug, billing_email, created_at, updated_at
  )
  VALUES (v_company_name, v_slug, NEW.email, NOW(), NOW())
  RETURNING id INTO v_company_id;

  -- ── Step 4: Grant owner membership ───────────────────────
  INSERT INTO public.company_users (
    company_id, user_id, role, status, created_at, updated_at
  )
  VALUES (v_company_id, NEW.id, 'owner', 'active', NOW(), NOW())
  ON CONFLICT (company_id, user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Attach to auth.users; drop first so re-running is safe.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();


-- ────────────────────────────────────────────────────────────
-- SECTION 3: Performance indexes for RLS
-- ────────────────────────────────────────────────────────────
-- get_my_company_ids() and get_my_company_user_ids() are called
-- on EVERY RLS policy check. Without a composite index on
-- (user_id, status) those functions do a sequential scan of
-- company_users on every single query — catastrophic at scale.

-- Critical: covers both helper functions' WHERE clauses
CREATE INDEX IF NOT EXISTS idx_company_users_user_status
  ON company_users (user_id, status);

-- Composite index for the common dashboard query pattern:
--   WHERE company_id = X AND scheduled_date BETWEEN ...
CREATE INDEX IF NOT EXISTS idx_visits_company_date
  ON visits (company_id, scheduled_date);

-- Composite index for expiring-product alert queries:
--   WHERE company_id = X AND expiry_date < NOW() + INTERVAL '30 days'
CREATE INDEX IF NOT EXISTS idx_expiring_company_expiry
  ON expiring_products (company_id, expiry_date);

-- Junction table lookups (needed for policy subqueries)
CREATE INDEX IF NOT EXISTS idx_place_products_place
  ON place_products (place_id);

CREATE INDEX IF NOT EXISTS idx_place_products_product
  ON place_products (product_id);

CREATE INDEX IF NOT EXISTS idx_visit_products_visit
  ON visit_products (visit_id);


-- ────────────────────────────────────────────────────────────
-- SECTION 4: Constraints
-- ────────────────────────────────────────────────────────────
-- All CHECK constraints are added NOT VALID so that existing
-- rows are not scanned immediately. This makes the migration
-- safe on a dev database that already has non-conforming data.
-- Enforce retroactively once data is clean:
--   ALTER TABLE companies VALIDATE CONSTRAINT chk_companies_slug;
--   ALTER TABLE schedules VALIDATE CONSTRAINT chk_schedules_time_order;

-- ── companies.slug ─────────────────────────────────────────
-- Slug: lowercase alphanumeric with interior hyphens, min 2 chars.
-- The handle_new_user() trigger always produces a conforming slug.
ALTER TABLE companies
  DROP CONSTRAINT IF EXISTS chk_companies_slug;

ALTER TABLE companies
  ADD CONSTRAINT chk_companies_slug
    CHECK (slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$') NOT VALID;

-- ── schedules time-order ───────────────────────────────────
-- Guard against logically invalid schedule windows.
ALTER TABLE schedules
  DROP CONSTRAINT IF EXISTS chk_schedules_time_order;

ALTER TABLE schedules
  ADD CONSTRAINT chk_schedules_time_order
    CHECK (end_time IS NULL OR start_time <= end_time) NOT VALID;

-- ── schedules UNIQUE merch/place/day ──────────────────────
-- UNIQUE constraints do NOT support NOT VALID in PostgreSQL
-- (only CHECK constraints and foreign keys do). Adding it
-- unconditionally would fail if duplicate schedule rows already
-- exist in a dev/demo database — aborting the entire migration
-- before migration 003 can even run.
--
-- Strategy: check for duplicates first inside a DO block.
-- If duplicates are found the migration continues safely and
-- prints a NOTICE with the exact cleanup query. The constraint
-- can then be added manually after cleanup.
--
-- Cleanup query (run if the NOTICE appears):
--   DELETE FROM schedules a
--   USING  schedules b
--   WHERE  a.id > b.id
--   AND    a.company_id  = b.company_id
--   AND    a.merch_id    = b.merch_id
--   AND    a.place_id    = b.place_id
--   AND    a.day_of_week = b.day_of_week;
--
-- Then add manually:
--   ALTER TABLE schedules
--     ADD CONSTRAINT uq_schedules_merch_place_day
--     UNIQUE (company_id, merch_id, place_id, day_of_week);
DO $$
BEGIN
  -- Drop any previous version first (makes this block idempotent).
  ALTER TABLE schedules
    DROP CONSTRAINT IF EXISTS uq_schedules_merch_place_day;

  IF EXISTS (
    SELECT 1
    FROM   schedules
    GROUP  BY company_id, merch_id, place_id, day_of_week
    HAVING COUNT(*) > 1
  ) THEN
    RAISE NOTICE
      '[002] SKIPPED uq_schedules_merch_place_day: '
      'duplicate schedule rows detected. '
      'Run the cleanup DELETE shown in migration 002 Section 4, '
      'then add the constraint manually.';
  ELSE
    ALTER TABLE schedules
      ADD CONSTRAINT uq_schedules_merch_place_day
      UNIQUE (company_id, merch_id, place_id, day_of_week);
    RAISE NOTICE '[002] OK: uq_schedules_merch_place_day added.';
  END IF;
END;
$$;


-- ────────────────────────────────────────────────────────────
-- SECTION 5: Drop ALL existing RLS policies (clean slate)
-- ────────────────────────────────────────────────────────────
-- Migration 001 created policies that:
--   • allowed any member to INSERT into sensitive tables (chains, places, etc.)
--   • were missing entirely on companies, users (INSERT), and junction tables
-- We drop everything and rebuild correctly below.

DROP POLICY IF EXISTS "companies_select" ON companies;
DROP POLICY IF EXISTS "companies_update" ON companies;

DROP POLICY IF EXISTS "users_select_own" ON users;
DROP POLICY IF EXISTS "users_update_own" ON users;

DROP POLICY IF EXISTS "company_users_select" ON company_users;
DROP POLICY IF EXISTS "company_users_insert" ON company_users;
DROP POLICY IF EXISTS "company_users_update" ON company_users;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'chains','places','products','templates',
    'schedules','visits','expiring_products','subscriptions'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%s_select" ON %s', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%s_insert" ON %s', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%s_update" ON %s', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%s_delete" ON %s', t, t);
  END LOOP;
END;
$$;

DROP POLICY IF EXISTS "place_products_select" ON place_products;
DROP POLICY IF EXISTS "visit_products_select"  ON visit_products;


-- ────────────────────────────────────────────────────────────
-- SECTION 6: Rebuild RLS policies — table by table
-- ────────────────────────────────────────────────────────────


-- ── COMPANIES ──────────────────────────────────────────────
-- INSERT is intentionally omitted: the handle_new_user()
-- trigger (SECURITY DEFINER) creates companies, bypassing RLS.
-- Billing webhooks must use the service_role key.

-- Any member can read their own company's info.
CREATE POLICY "companies_select" ON companies
  FOR SELECT USING (
    id = ANY(get_my_company_ids())
  );

-- Only owner or admin can update company settings.
CREATE POLICY "companies_update" ON companies
  FOR UPDATE
  USING     (id = ANY(get_my_company_ids()) AND get_my_role(id) IN ('owner','admin'))
  WITH CHECK(id = ANY(get_my_company_ids()) AND get_my_role(id) IN ('owner','admin'));


-- ── USERS ──────────────────────────────────────────────────

-- A user can see their own profile.
-- A user can also see the profiles of active teammates —
-- required for any UI that shows member names or avatars.
CREATE POLICY "users_select" ON users
  FOR SELECT USING (
    id = auth.uid()
    OR id IN (
      SELECT user_id
      FROM   company_users
      WHERE  company_id = ANY(get_my_company_ids())
      AND    status = 'active'
    )
  );

-- Covers edge-cases where the profile must be created manually
-- (e.g. social login without metadata). Trigger is primary path.
CREATE POLICY "users_insert" ON users
  FOR INSERT WITH CHECK (id = auth.uid());

-- Users can only edit their own profile.
CREATE POLICY "users_update" ON users
  FOR UPDATE
  USING     (id = auth.uid())
  WITH CHECK(id = auth.uid());


-- ── COMPANY_USERS ───────────────────────────────────────────

-- Any active member can see the full member list for their company
-- (needed to assign merchandisers, display team directory, etc.).
CREATE POLICY "company_users_select" ON company_users
  FOR SELECT USING (
    company_id = ANY(get_my_company_ids())
  );

-- Only owner / admin can invite new members.
CREATE POLICY "company_users_insert" ON company_users
  FOR INSERT WITH CHECK (
    get_my_role(company_id) IN ('owner','admin')
  );

-- Only owner / admin can change roles, status, or metadata.
CREATE POLICY "company_users_update" ON company_users
  FOR UPDATE
  USING     (get_my_role(company_id) IN ('owner','admin'))
  WITH CHECK(get_my_role(company_id) IN ('owner','admin'));

-- Only the owner can remove members.
-- The owner cannot remove themselves to prevent orphaned companies.
CREATE POLICY "company_users_delete" ON company_users
  FOR DELETE USING (
    get_my_role(company_id) = 'owner'
    AND user_id <> auth.uid()
  );


-- ── CHAINS ─────────────────────────────────────────────────

-- Any member can browse the chain directory.
CREATE POLICY "chains_select" ON chains
  FOR SELECT USING (company_id = ANY(get_my_company_ids()));

-- Only owner / admin can create, edit, or remove chains.
CREATE POLICY "chains_insert" ON chains
  FOR INSERT WITH CHECK (
    company_id = ANY(get_my_company_ids())
    AND get_my_role(company_id) IN ('owner','admin')
  );

CREATE POLICY "chains_update" ON chains
  FOR UPDATE
  USING     (company_id = ANY(get_my_company_ids()) AND get_my_role(company_id) IN ('owner','admin'))
  WITH CHECK(company_id = ANY(get_my_company_ids()) AND get_my_role(company_id) IN ('owner','admin'));

CREATE POLICY "chains_delete" ON chains
  FOR DELETE USING (
    company_id = ANY(get_my_company_ids())
    AND get_my_role(company_id) IN ('owner','admin')
  );


-- ── PLACES (branches) ──────────────────────────────────────

-- All members can view branch locations.
CREATE POLICY "places_select" ON places
  FOR SELECT USING (company_id = ANY(get_my_company_ids()));

-- Only owner / admin can manage branches.
CREATE POLICY "places_insert" ON places
  FOR INSERT WITH CHECK (
    company_id = ANY(get_my_company_ids())
    AND get_my_role(company_id) IN ('owner','admin')
  );

CREATE POLICY "places_update" ON places
  FOR UPDATE
  USING     (company_id = ANY(get_my_company_ids()) AND get_my_role(company_id) IN ('owner','admin'))
  WITH CHECK(company_id = ANY(get_my_company_ids()) AND get_my_role(company_id) IN ('owner','admin'));

CREATE POLICY "places_delete" ON places
  FOR DELETE USING (
    company_id = ANY(get_my_company_ids())
    AND get_my_role(company_id) IN ('owner','admin')
  );


-- ── PRODUCTS ───────────────────────────────────────────────

-- All members can view the product catalog (needed during visits).
CREATE POLICY "products_select" ON products
  FOR SELECT USING (company_id = ANY(get_my_company_ids()));

-- Only owner / admin can manage the catalog.
CREATE POLICY "products_insert" ON products
  FOR INSERT WITH CHECK (
    company_id = ANY(get_my_company_ids())
    AND get_my_role(company_id) IN ('owner','admin')
  );

CREATE POLICY "products_update" ON products
  FOR UPDATE
  USING     (company_id = ANY(get_my_company_ids()) AND get_my_role(company_id) IN ('owner','admin'))
  WITH CHECK(company_id = ANY(get_my_company_ids()) AND get_my_role(company_id) IN ('owner','admin'));

CREATE POLICY "products_delete" ON products
  FOR DELETE USING (
    company_id = ANY(get_my_company_ids())
    AND get_my_role(company_id) IN ('owner','admin')
  );


-- ── TEMPLATES ──────────────────────────────────────────────

-- All members can read visit templates (merchandisers use them in the field).
CREATE POLICY "templates_select" ON templates
  FOR SELECT USING (company_id = ANY(get_my_company_ids()));

-- Only owner / admin can author or retire templates.
CREATE POLICY "templates_insert" ON templates
  FOR INSERT WITH CHECK (
    company_id = ANY(get_my_company_ids())
    AND get_my_role(company_id) IN ('owner','admin')
  );

CREATE POLICY "templates_update" ON templates
  FOR UPDATE
  USING     (company_id = ANY(get_my_company_ids()) AND get_my_role(company_id) IN ('owner','admin'))
  WITH CHECK(company_id = ANY(get_my_company_ids()) AND get_my_role(company_id) IN ('owner','admin'));

CREATE POLICY "templates_delete" ON templates
  FOR DELETE USING (
    company_id = ANY(get_my_company_ids())
    AND get_my_role(company_id) IN ('owner','admin')
  );


-- ── SCHEDULES ──────────────────────────────────────────────

-- All members can view the schedule (merchandisers see their assignments).
CREATE POLICY "schedules_select" ON schedules
  FOR SELECT USING (company_id = ANY(get_my_company_ids()));

-- Only owner / admin can create, change, or delete schedule assignments.
CREATE POLICY "schedules_insert" ON schedules
  FOR INSERT WITH CHECK (
    company_id = ANY(get_my_company_ids())
    AND get_my_role(company_id) IN ('owner','admin')
  );

CREATE POLICY "schedules_update" ON schedules
  FOR UPDATE
  USING     (company_id = ANY(get_my_company_ids()) AND get_my_role(company_id) IN ('owner','admin'))
  WITH CHECK(company_id = ANY(get_my_company_ids()) AND get_my_role(company_id) IN ('owner','admin'));

CREATE POLICY "schedules_delete" ON schedules
  FOR DELETE USING (
    company_id = ANY(get_my_company_ids())
    AND get_my_role(company_id) IN ('owner','admin')
  );


-- ── VISITS ─────────────────────────────────────────────────
-- Asymmetric access: admins see everything; merchandisers see
-- only visits assigned to them (merch_id matches their
-- company_users.id row).

-- Owner / admin: all company visits.
-- Merchandiser: only visits where they are the assigned merch.
CREATE POLICY "visits_select" ON visits
  FOR SELECT USING (
    company_id = ANY(get_my_company_ids())
    AND (
      get_my_role(company_id) IN ('owner','admin')
      OR merch_id = ANY(get_my_company_user_ids())
    )
  );

-- Only owner / admin schedules (creates) visits.
CREATE POLICY "visits_insert" ON visits
  FOR INSERT WITH CHECK (
    company_id = ANY(get_my_company_ids())
    AND get_my_role(company_id) IN ('owner','admin')
  );

-- Owner / admin can update any visit.
-- Merchandiser can update their own visit to record check-in time,
-- GPS coordinates, status changes, and notes — but cannot change
-- company_id or merch_id (enforced by WITH CHECK).
CREATE POLICY "visits_update" ON visits
  FOR UPDATE
  USING (
    company_id = ANY(get_my_company_ids())
    AND (
      get_my_role(company_id) IN ('owner','admin')
      OR merch_id = ANY(get_my_company_user_ids())
    )
  )
  WITH CHECK (
    company_id = ANY(get_my_company_ids())
    AND (
      get_my_role(company_id) IN ('owner','admin')
      OR merch_id = ANY(get_my_company_user_ids())
    )
  );

-- Only owner / admin can delete visits.
CREATE POLICY "visits_delete" ON visits
  FOR DELETE USING (
    company_id = ANY(get_my_company_ids())
    AND get_my_role(company_id) IN ('owner','admin')
  );


-- ── PLACE_PRODUCTS ─────────────────────────────────────────
-- Junction table: which products are tracked at which branch.
-- Migration 001 only had SELECT; INSERT/DELETE were missing,
-- so nobody could assign products to branches.

-- All members can see product assignments (merchandisers need
-- to know which products to check at a location).
CREATE POLICY "place_products_select" ON place_products
  FOR SELECT USING (
    place_id IN (
      SELECT id FROM places WHERE company_id = ANY(get_my_company_ids())
    )
  );

-- Only owner / admin can assign products to a branch.
CREATE POLICY "place_products_insert" ON place_products
  FOR INSERT WITH CHECK (
    place_id IN (
      SELECT id FROM places
      WHERE  company_id = ANY(get_my_company_ids())
      AND    get_my_role(company_id) IN ('owner','admin')
    )
  );

-- Only owner / admin can remove product assignments.
CREATE POLICY "place_products_delete" ON place_products
  FOR DELETE USING (
    place_id IN (
      SELECT id FROM places
      WHERE  company_id = ANY(get_my_company_ids())
      AND    get_my_role(company_id) IN ('owner','admin')
    )
  );


-- ── VISIT_PRODUCTS ─────────────────────────────────────────
-- Records products checked during a visit (quantities, missing).
-- Migration 001 only had SELECT; INSERT/UPDATE/DELETE were
-- missing, making visit recording impossible.

-- All members can view product data for their company's visits.
CREATE POLICY "visit_products_select" ON visit_products
  FOR SELECT USING (
    visit_id IN (
      SELECT id FROM visits WHERE company_id = ANY(get_my_company_ids())
    )
  );

-- Owner / admin can record for any visit.
-- Assigned merchandiser can record for their own visit.
CREATE POLICY "visit_products_insert" ON visit_products
  FOR INSERT WITH CHECK (
    visit_id IN (
      SELECT id FROM visits
      WHERE  company_id = ANY(get_my_company_ids())
      AND (
        get_my_role(company_id) IN ('owner','admin')
        OR merch_id = ANY(get_my_company_user_ids())
      )
    )
  );

-- Same access pattern for corrections / quantity updates.
CREATE POLICY "visit_products_update" ON visit_products
  FOR UPDATE USING (
    visit_id IN (
      SELECT id FROM visits
      WHERE  company_id = ANY(get_my_company_ids())
      AND (
        get_my_role(company_id) IN ('owner','admin')
        OR merch_id = ANY(get_my_company_user_ids())
      )
    )
  );

-- Only owner / admin can delete recorded product data.
CREATE POLICY "visit_products_delete" ON visit_products
  FOR DELETE USING (
    visit_id IN (
      SELECT id FROM visits
      WHERE  company_id = ANY(get_my_company_ids())
      AND    get_my_role(company_id) IN ('owner','admin')
    )
  );


-- ── EXPIRING_PRODUCTS ──────────────────────────────────────

-- All members can view expiry alerts (needed for dashboard KPIs).
CREATE POLICY "expiring_products_select" ON expiring_products
  FOR SELECT USING (company_id = ANY(get_my_company_ids()));

-- Any company member can log an expiring product — merchandisers
-- commonly record this in the field during a visit.
CREATE POLICY "expiring_products_insert" ON expiring_products
  FOR INSERT WITH CHECK (company_id = ANY(get_my_company_ids()));

-- Only owner / admin can correct or remove expiry records.
CREATE POLICY "expiring_products_update" ON expiring_products
  FOR UPDATE
  USING     (company_id = ANY(get_my_company_ids()) AND get_my_role(company_id) IN ('owner','admin'))
  WITH CHECK(company_id = ANY(get_my_company_ids()) AND get_my_role(company_id) IN ('owner','admin'));

CREATE POLICY "expiring_products_delete" ON expiring_products
  FOR DELETE USING (
    company_id = ANY(get_my_company_ids())
    AND get_my_role(company_id) IN ('owner','admin')
  );


-- ── SUBSCRIPTIONS ──────────────────────────────────────────
-- Billing data is sensitive. Merchandisers should never see it.
-- INSERT / UPDATE are reserved for the billing webhook via
-- service_role key — no user-facing policy needed.

-- Only owner / admin can view subscription and billing history.
CREATE POLICY "subscriptions_select" ON subscriptions
  FOR SELECT USING (
    company_id = ANY(get_my_company_ids())
    AND get_my_role(company_id) IN ('owner','admin')
  );

-- No INSERT / UPDATE / DELETE policies for authenticated users.
-- All subscription mutations go through service_role (webhooks).
