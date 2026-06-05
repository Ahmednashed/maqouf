-- ============================================================
-- Malgoof SaaS — Initial Database Schema
-- Multi-tenant: every table has company_id (Row Level Security)
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- Arabic/EN text search

-- ────────────────────────────────────────────────────────────
-- ENUMS
-- ────────────────────────────────────────────────────────────
CREATE TYPE subscription_plan   AS ENUM ('starter','growth','business','enterprise');
CREATE TYPE subscription_status AS ENUM ('trialing','active','past_due','canceled');
CREATE TYPE user_role            AS ENUM ('owner','admin','merchandiser');
CREATE TYPE user_status          AS ENUM ('active','inactive');
CREATE TYPE visit_status         AS ENUM ('pending','inprogress','completed','missed');
CREATE TYPE product_category     AS ENUM ('beverages','snacks','dairy','bakery','frozen');
CREATE TYPE product_unit         AS ENUM ('piece','box','carton','kg','liter');
CREATE TYPE template_status      AS ENUM ('active','draft');
CREATE TYPE day_of_week          AS ENUM ('0','1','2','3','4','5','6');

-- ────────────────────────────────────────────────────────────
-- COMPANIES
-- ────────────────────────────────────────────────────────────
CREATE TABLE companies (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                 TEXT NOT NULL,
  slug                 TEXT NOT NULL UNIQUE,
  logo_url             TEXT,
  subscription_plan    subscription_plan   NOT NULL DEFAULT 'starter',
  subscription_status  subscription_status NOT NULL DEFAULT 'trialing',
  trial_ends_at        TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '14 days'),
  max_users            INT  NOT NULL DEFAULT 5,
  billing_email        TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- USERS  (mirrors auth.users — public profile)
-- ────────────────────────────────────────────────────────────
CREATE TABLE users (
  id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email        TEXT NOT NULL UNIQUE,
  full_name    TEXT NOT NULL,
  avatar_url   TEXT,
  phone        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- COMPANY_USERS  (membership + role)
-- ────────────────────────────────────────────────────────────
CREATE TABLE company_users (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         user_role   NOT NULL DEFAULT 'merchandiser',
  emp_id       TEXT,
  region       TEXT,
  color        TEXT DEFAULT '#6366F1',   -- avatar color
  status       user_status NOT NULL DEFAULT 'active',
  invited_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, user_id)
);
CREATE INDEX idx_company_users_company ON company_users(company_id);
CREATE INDEX idx_company_users_user    ON company_users(user_id);

-- ────────────────────────────────────────────────────────────
-- CHAINS
-- ────────────────────────────────────────────────────────────
CREATE TABLE chains (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name_ar      TEXT NOT NULL,
  name_en      TEXT NOT NULL,
  code         TEXT NOT NULL,
  logo_url     TEXT,
  color        TEXT DEFAULT '#111827',
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, code)
);
CREATE INDEX idx_chains_company ON chains(company_id);

-- ────────────────────────────────────────────────────────────
-- PLACES  (branches)
-- ────────────────────────────────────────────────────────────
CREATE TABLE places (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  chain_id         UUID NOT NULL REFERENCES chains(id)   ON DELETE CASCADE,
  branch_ar        TEXT NOT NULL,
  branch_en        TEXT NOT NULL,
  code             TEXT NOT NULL,
  address_ar       TEXT,
  address_en       TEXT,
  city_ar          TEXT,
  city_en          TEXT,
  region           TEXT,
  lat              DECIMAL(10,7),
  lng              DECIMAL(10,7),
  assigned_user_id UUID REFERENCES company_users(id) ON DELETE SET NULL,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, code)
);
CREATE INDEX idx_places_company ON places(company_id);
CREATE INDEX idx_places_chain   ON places(chain_id);

-- ────────────────────────────────────────────────────────────
-- PRODUCTS
-- ────────────────────────────────────────────────────────────
CREATE TABLE products (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  sku          TEXT NOT NULL,
  name_ar      TEXT NOT NULL,
  name_en      TEXT NOT NULL,
  category     product_category NOT NULL,
  unit         product_unit     NOT NULL DEFAULT 'piece',
  cost         DECIMAL(10,2),
  price        DECIMAL(10,2),
  stock        INT  NOT NULL DEFAULT 0,
  image_url    TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, sku)
);
CREATE INDEX idx_products_company ON products(company_id);

-- ────────────────────────────────────────────────────────────
-- PLACE_PRODUCTS  (which products are tracked at a place)
-- ────────────────────────────────────────────────────────────
CREATE TABLE place_products (
  place_id     UUID NOT NULL REFERENCES places(id)   ON DELETE CASCADE,
  product_id   UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (place_id, product_id)
);

-- ────────────────────────────────────────────────────────────
-- TEMPLATES
-- ────────────────────────────────────────────────────────────
CREATE TABLE templates (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name_ar      TEXT NOT NULL,
  name_en      TEXT NOT NULL,
  description  TEXT,
  fields       JSONB NOT NULL DEFAULT '[]',   -- TemplateField[]
  status       template_status NOT NULL DEFAULT 'draft',
  usage_count  INT  NOT NULL DEFAULT 0,
  created_by   UUID REFERENCES company_users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_templates_company ON templates(company_id);

-- ────────────────────────────────────────────────────────────
-- SCHEDULES
-- ────────────────────────────────────────────────────────────
CREATE TABLE schedules (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES companies(id)      ON DELETE CASCADE,
  merch_id     UUID NOT NULL REFERENCES company_users(id)  ON DELETE CASCADE,
  place_id     UUID NOT NULL REFERENCES places(id)         ON DELETE CASCADE,
  day_of_week  day_of_week NOT NULL,
  start_time   TIME  NOT NULL,
  end_time     TIME,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_schedules_company ON schedules(company_id);
CREATE INDEX idx_schedules_merch   ON schedules(merch_id);

-- ────────────────────────────────────────────────────────────
-- VISITS
-- ────────────────────────────────────────────────────────────
CREATE TABLE visits (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id        UUID NOT NULL REFERENCES companies(id)     ON DELETE CASCADE,
  place_id          UUID NOT NULL REFERENCES places(id)        ON DELETE CASCADE,
  merch_id          UUID NOT NULL REFERENCES company_users(id) ON DELETE CASCADE,
  template_id       UUID REFERENCES templates(id) ON DELETE SET NULL,
  status            visit_status NOT NULL DEFAULT 'pending',
  scheduled_date    DATE NOT NULL,
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  duration_minutes  INT  NOT NULL DEFAULT 0,
  notes             TEXT,
  lat               DECIMAL(10,7),
  lng               DECIMAL(10,7),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_visits_company       ON visits(company_id);
CREATE INDEX idx_visits_place         ON visits(place_id);
CREATE INDEX idx_visits_merch         ON visits(merch_id);
CREATE INDEX idx_visits_scheduled_date ON visits(scheduled_date);

-- ────────────────────────────────────────────────────────────
-- VISIT_PRODUCTS  (products checked during a visit)
-- ────────────────────────────────────────────────────────────
CREATE TABLE visit_products (
  visit_id     UUID NOT NULL REFERENCES visits(id)   ON DELETE CASCADE,
  product_id   UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty_found    INT,
  qty_missing  INT,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (visit_id, product_id)
);

-- ────────────────────────────────────────────────────────────
-- EXPIRING_PRODUCTS
-- ────────────────────────────────────────────────────────────
CREATE TABLE expiring_products (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES companies(id)  ON DELETE CASCADE,
  place_id     UUID NOT NULL REFERENCES places(id)     ON DELETE CASCADE,
  product_id   UUID NOT NULL REFERENCES products(id)   ON DELETE CASCADE,
  batch        TEXT NOT NULL,
  qty          INT  NOT NULL DEFAULT 0,
  expiry_date  DATE NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_expiring_company     ON expiring_products(company_id);
CREATE INDEX idx_expiring_expiry_date ON expiring_products(expiry_date);

-- ────────────────────────────────────────────────────────────
-- SUBSCRIPTIONS  (billing history)
-- ────────────────────────────────────────────────────────────
CREATE TABLE subscriptions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  plan                subscription_plan   NOT NULL,
  status              subscription_status NOT NULL,
  current_period_start TIMESTAMPTZ NOT NULL,
  current_period_end  TIMESTAMPTZ NOT NULL,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  payment_provider    TEXT,
  provider_sub_id     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- UPDATED_AT TRIGGER (auto-update)
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'companies','users','company_users','chains','places',
    'products','templates','visits','subscriptions'
  ] LOOP
    EXECUTE format('
      CREATE TRIGGER trg_%s_updated_at
      BEFORE UPDATE ON %s
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    ', t, t);
  END LOOP;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY (RLS)
-- ────────────────────────────────────────────────────────────

-- Helper: get current user's company_id(s)
CREATE OR REPLACE FUNCTION get_my_company_ids()
RETURNS UUID[] AS $$
  SELECT ARRAY(
    SELECT company_id FROM company_users
    WHERE user_id = auth.uid()
    AND status = 'active'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper: get current user's role in a company
CREATE OR REPLACE FUNCTION get_my_role(p_company_id UUID)
RETURNS user_role AS $$
  SELECT role FROM company_users
  WHERE user_id = auth.uid()
  AND company_id = p_company_id
  AND status = 'active'
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Enable RLS on all tables
ALTER TABLE companies         ENABLE ROW LEVEL SECURITY;
ALTER TABLE users             ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_users     ENABLE ROW LEVEL SECURITY;
ALTER TABLE chains            ENABLE ROW LEVEL SECURITY;
ALTER TABLE places            ENABLE ROW LEVEL SECURITY;
ALTER TABLE products          ENABLE ROW LEVEL SECURITY;
ALTER TABLE place_products    ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates         ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedules         ENABLE ROW LEVEL SECURITY;
ALTER TABLE visits            ENABLE ROW LEVEL SECURITY;
ALTER TABLE visit_products    ENABLE ROW LEVEL SECURITY;
ALTER TABLE expiring_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions     ENABLE ROW LEVEL SECURITY;

-- COMPANIES: member can read; owner/admin can update
CREATE POLICY "companies_select" ON companies FOR SELECT
  USING (id = ANY(get_my_company_ids()));

CREATE POLICY "companies_update" ON companies FOR UPDATE
  USING (get_my_role(id) IN ('owner','admin'));

-- USERS: each user sees their own profile
CREATE POLICY "users_select_own" ON users FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "users_update_own" ON users FOR UPDATE
  USING (id = auth.uid());

-- COMPANY_USERS: members see their company's members
CREATE POLICY "company_users_select" ON company_users FOR SELECT
  USING (company_id = ANY(get_my_company_ids()));

CREATE POLICY "company_users_insert" ON company_users FOR INSERT
  WITH CHECK (get_my_role(company_id) IN ('owner','admin'));

CREATE POLICY "company_users_update" ON company_users FOR UPDATE
  USING (get_my_role(company_id) IN ('owner','admin'));

-- Generic multi-tenant policy factory for company_id tables
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'chains','places','products','templates',
    'schedules','visits','expiring_products','subscriptions'
  ] LOOP
    EXECUTE format('
      CREATE POLICY "%s_select" ON %s FOR SELECT
        USING (company_id = ANY(get_my_company_ids()));
      CREATE POLICY "%s_insert" ON %s FOR INSERT
        WITH CHECK (company_id = ANY(get_my_company_ids()));
      CREATE POLICY "%s_update" ON %s FOR UPDATE
        USING (company_id = ANY(get_my_company_ids()));
      CREATE POLICY "%s_delete" ON %s FOR DELETE
        USING (get_my_role(company_id) IN (''owner'',''admin''));
    ', t,t, t,t, t,t, t,t);
  END LOOP;
END;
$$;

-- Junction tables (place_products, visit_products)
CREATE POLICY "place_products_select" ON place_products FOR SELECT
  USING (place_id IN (
    SELECT id FROM places WHERE company_id = ANY(get_my_company_ids())
  ));

CREATE POLICY "visit_products_select" ON visit_products FOR SELECT
  USING (visit_id IN (
    SELECT id FROM visits WHERE company_id = ANY(get_my_company_ids())
  ));
