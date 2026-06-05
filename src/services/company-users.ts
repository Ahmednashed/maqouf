import { createClient } from "@/lib/supabase/client";
import type { CompanyUser, User, UserRole } from "@/types";
import { getMyCompanyId } from "@/lib/supabase/helpers";

// ─── Extended type ────────────────────────────────────────────────────────────

/**
 * A company_users row with the joined public.users profile always present.
 * Used by the schedule module (needs full_name / avatar_url only) and
 * the users management page (needs email too).
 */
export type CompanyUserWithProfile = Omit<CompanyUser, "user"> & {
  user: Pick<User, "id" | "email" | "full_name" | "avatar_url" | "phone">;
};

// ─── Payload types ────────────────────────────────────────────────────────────

export interface CompanyUserUpdate {
  role?:   UserRole;
  color?:  string;
  emp_id?: string;
  region?: string;
  status?: "active" | "inactive";
}

export interface CompanyUserManualCreate {
  email:   string;  // Registered user's email — resolved to user_id server-side
  role:    UserRole;
  color?:  string;
  emp_id?: string;
  region?: string;
}

// ─── Read — all statuses (for users management page) ─────────────────────────

/**
 * Fetch ALL members of the current company (active + inactive).
 * Used exclusively by the users management page.
 * RLS scopes to the authenticated user's company automatically.
 */
export async function fetchAllCompanyUsers(): Promise<CompanyUserWithProfile[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("company_users")
    .select("*, user:users!company_users_user_id_fkey(id, email, full_name, avatar_url, phone)")
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data ?? []) as CompanyUserWithProfile[];
}

// ─── Read — active only (for dropdowns / schedule module) ────────────────────

/**
 * Fetch active members of the current user's company.
 * Pass `role` to narrow to a specific role (e.g. "merchandiser").
 */
export async function fetchCompanyUsers(
  role?: UserRole
): Promise<CompanyUserWithProfile[]> {
  const supabase = createClient();

  let query = supabase
    .from("company_users")
    .select("*, user:users!company_users_user_id_fkey(id, email, full_name, avatar_url, phone)")
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (role) {
    query = query.eq("role", role);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as CompanyUserWithProfile[];
}

// ─── Update ───────────────────────────────────────────────────────────────────

/**
 * Update a company_users record (role, color, emp_id, region, status).
 * RLS restricts this to owner/admin only.
 */
export async function updateCompanyUser(
  id:      string,
  payload: CompanyUserUpdate
): Promise<CompanyUser> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("company_users")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data as CompanyUser;
}

// ─── Email lookup ─────────────────────────────────────────────────────────────

/**
 * Look up a registered user in public.users by their email address.
 * Returns the user's id + display name, or null if not found.
 *
 * RLS note: authenticated users can read public.users (evidenced by existing
 * join queries throughout the app). This never touches auth.users, so no
 * service-role key is required.
 */
export async function findUserByEmail(
  email: string
): Promise<{ id: string; full_name: string } | null> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("users")
    .select("id, full_name")
    .eq("email", email.trim().toLowerCase())
    .maybeSingle();   // returns null (not error) when no row found

  if (error) throw error;
  return data ?? null;
}

// ─── Manual create (email-based lookup) ──────────────────────────────────────

/**
 * Link an already-registered user to this company by looking them up by email.
 *
 * Flow:
 *   1. Query public.users for the given email.
 *   2. If not found → throw a user-friendly error ("must register first").
 *   3. If found     → insert into company_users using the resolved user_id.
 *
 * ⚠️  Superseded: New member invitations are now handled by the
 *    `invite-company-user` Edge Function (src/services/invitations.ts),
 *    which calls supabase.auth.admin.inviteUserByEmail() server-side.
 *    This manual lookup is retained only for internal use by that flow.
 */
export async function createCompanyUserManual(
  payload: CompanyUserManualCreate
): Promise<CompanyUser> {
  const supabase   = createClient();
  const company_id = await getMyCompanyId();

  // ── Step 1: resolve email → user_id ────────────────────────────────────────
  const found = await findUserByEmail(payload.email);
  if (!found) {
    throw new Error(
      "No account found for that email address. " +
      "The person must sign up at /signup before they can be added."
    );
  }

  // ── Step 2: create the company membership ───────────────────────────────────
  const { data, error } = await supabase
    .from("company_users")
    .insert({
      company_id,
      user_id:  found.id,
      role:     payload.role,
      color:    payload.color  ?? "#6366F1",
      emp_id:   payload.emp_id,
      region:   payload.region,
      status:   "active",
    })
    .select()
    .single();

  if (error) {
    // Unique constraint: this user is already a member
    if (error.code === "23505") {
      throw new Error(`${found.full_name} is already a member of this company.`);
    }
    throw error;
  }

  return data as CompanyUser;
}
