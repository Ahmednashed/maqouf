-- ============================================================
-- Migration 007 — User Invitation Flow
-- ============================================================
-- Creates the company_user_invitations staging table and
-- replaces handle_new_user() so that invited users are linked
-- to the inviting company instead of getting a new company.
--
-- HOW IT WORKS
-- ─────────────
-- The invite-company-user Edge Function:
--   1. Inserts a company_user_invitations row   (committed first)
--   2. Calls supabase.auth.admin.inviteUserByEmail()
--
-- When Supabase creates the auth.users row, handle_new_user()
-- fires, reads the pending invitation, and creates public.users
-- + company_users linked to the correct company.
--
-- If the invited user already has an account (public.users row
-- exists), the Edge Function skips steps 1-2 and inserts
-- company_users directly without touching this trigger.
--
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE.
-- ============================================================


-- ── 1. Invitations staging table ─────────────────────────────

CREATE TABLE IF NOT EXISTS company_user_invitations (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email        TEXT        NOT NULL,
  role         user_role   NOT NULL DEFAULT 'merchandiser',
  color        TEXT                 DEFAULT '#6366F1',
  emp_id       TEXT,
  region       TEXT,
  -- The public.users.id of the owner/admin who sent the invite.
  -- SET NULL so a deleted inviter does not orphan the record.
  invited_by   UUID        REFERENCES users(id) ON DELETE SET NULL,
  accepted_at  TIMESTAMPTZ,          -- stamped by the trigger on acceptance
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup in the trigger: WHERE email = ? AND accepted_at IS NULL
CREATE INDEX IF NOT EXISTS idx_invitations_email_pending
  ON company_user_invitations (email, accepted_at);

CREATE INDEX IF NOT EXISTS idx_invitations_company
  ON company_user_invitations (company_id);


-- ── 2. RLS for company_user_invitations ──────────────────────

ALTER TABLE company_user_invitations ENABLE ROW LEVEL SECURITY;

-- Owner / admin can view their company's pending invitations.
DROP POLICY IF EXISTS "invitations_select" ON company_user_invitations;
CREATE POLICY "invitations_select" ON company_user_invitations
  FOR SELECT USING (
    company_id = ANY(get_my_company_ids())
    AND get_my_role(company_id) IN ('owner', 'admin')
  );

-- All DML (INSERT / UPDATE / DELETE) is performed by the
-- Edge Function via service_role, which bypasses RLS entirely.
-- No user-facing INSERT/UPDATE/DELETE policies are needed.


-- ── 3. Replace handle_new_user() ─────────────────────────────
-- The previous version always created a new company.
-- This version first checks for a pending invitation and, if
-- found, links the user to the inviting company instead.
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invitation   RECORD;
  v_company_id   UUID;
  v_company_name TEXT;
  v_full_name    TEXT;
  v_phone        TEXT;
  v_base_slug    TEXT;
  v_slug         TEXT;
  v_counter      INT := 0;
BEGIN
  -- Pull display name and phone from Auth metadata.
  -- Falls back to the email username for invited users who have
  -- not yet set a name (they will complete it on first login).
  v_full_name := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''),
    split_part(NEW.email, '@', 1)
  );
  v_phone := NULLIF(trim(NEW.raw_user_meta_data->>'phone'), '');

  -- ── Step 1: Create public profile (required for all users) ──
  INSERT INTO public.users (id, email, full_name, phone, created_at, updated_at)
  VALUES (NEW.id, NEW.email, v_full_name, v_phone, NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;

  -- ── Step 2: Check for a pending invitation ───────────────────
  -- The Edge Function inserts the invitation row and commits it
  -- BEFORE calling inviteUserByEmail(), so this SELECT will
  -- always find the record when the trigger fires for an invite.
  SELECT *
  INTO   v_invitation
  FROM   public.company_user_invitations
  WHERE  email       = NEW.email
  AND    accepted_at IS NULL
  ORDER  BY created_at DESC
  LIMIT  1;

  IF FOUND THEN
    -- ── Invited-user path ──────────────────────────────────────
    -- Link to the inviting company; do NOT create a new company.
    INSERT INTO public.company_users (
      company_id, user_id, role, color, emp_id, region,
      status, invited_by, created_at, updated_at
    )
    VALUES (
      v_invitation.company_id,
      NEW.id,
      v_invitation.role,
      COALESCE(v_invitation.color, '#6366F1'),
      v_invitation.emp_id,
      v_invitation.region,
      'active',
      v_invitation.invited_by,
      NOW(),
      NOW()
    )
    ON CONFLICT (company_id, user_id) DO NOTHING;

    -- Stamp so duplicate trigger calls (retried invites) are safe.
    UPDATE public.company_user_invitations
    SET    accepted_at = NOW()
    WHERE  id = v_invitation.id;

    RETURN NEW;
  END IF;

  -- ── Self-registration path ───────────────────────────────────
  -- No pending invitation → standard signup: create a new company
  -- and grant the new user owner membership (original behaviour).

  v_company_name := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data->>'company_name'), ''),
    'My Company'
  );

  v_base_slug := trim(both '-' from
    regexp_replace(
      lower(regexp_replace(v_company_name, '[^a-zA-Z0-9]+', '-', 'g')),
      '-{2,}', '-', 'g'
    )
  );

  -- Fallback: purely non-Latin company name → derive slug from email.
  IF v_base_slug = '' OR length(v_base_slug) < 2 THEN
    v_base_slug := trim(both '-' from
      lower(regexp_replace(split_part(NEW.email, '@', 1), '[^a-z0-9]+', '-', 'g'))
    );
  END IF;

  -- Safety net: minimum slug length.
  IF length(v_base_slug) < 2 THEN
    v_base_slug := 'co';
  END IF;

  -- Guarantee uniqueness by appending an incrementing counter.
  v_slug := v_base_slug;
  WHILE EXISTS (SELECT 1 FROM public.companies WHERE slug = v_slug) LOOP
    v_counter := v_counter + 1;
    v_slug    := v_base_slug || '-' || v_counter;
  END LOOP;

  INSERT INTO public.companies (name, slug, billing_email, created_at, updated_at)
  VALUES (v_company_name, v_slug, NEW.email, NOW(), NOW())
  RETURNING id INTO v_company_id;

  INSERT INTO public.company_users (
    company_id, user_id, role, status, created_at, updated_at
  )
  VALUES (v_company_id, NEW.id, 'owner', 'active', NOW(), NOW())
  ON CONFLICT (company_id, user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Trigger is already attached from migration 002; OR REPLACE above
-- updates the function body without touching the trigger binding.
