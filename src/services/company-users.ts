import { createClient } from "@/lib/supabase/client";
import type { CompanyUser, User, UserRole } from "@/types";
import { getMyCompanyId } from "@/lib/supabase/helpers";

// ─── Extended type ────────────────────────────────────────────────────────────

/**
 * A company_users row with the joined public.users profile.
 *
 * `user` is typed as nullable because Supabase returns null when the
 * referenced auth user has been hard-deleted from auth.users while the
 * company_users row still exists (orphaned record scenario).
 *
 * Use the member-level helpers (memberDisplayName, memberEmail, memberInitials,
 * memberAvatarUrl) instead of accessing `user` directly — they automatically
 * fall back to the cached display_name / display_email columns so orphaned
 * users never appear as "Unknown User".
 */
export type CompanyUserWithProfile = Omit<CompanyUser, "user"> & {
  user: Pick<User, "id" | "email" | "full_name" | "avatar_url" | "phone"> | null;
};

// ─── Member-level display helpers (prefer these over safeUserName) ────────────

/**
 * Best available display name:
 *   company_users.display_name (admin override) → auth-user full_name → fallback
 *
 * display_name is checked first so admins can override the name shown in the
 * UI without touching the auth account.  Orphaned records (null user join)
 * still show their cached name via the display_name column.
 */
export function memberDisplayName(
  member: CompanyUserWithProfile,
  fallback = "—",
): string {
  return (
    member.display_name?.trim()    ||
    member.user?.full_name?.trim() ||
    fallback
  );
}

/**
 * Best available email:
 *   auth-user email → cached display_email → "—"
 */
export function memberEmail(member: CompanyUserWithProfile): string {
  return member.user?.email || member.display_email || "—";
}

/**
 * Best available avatar URL:
 *   company-level avatar_url → auth-user avatar_url → null
 */
export function memberAvatarUrl(member: CompanyUserWithProfile): string | null {
  return member.avatar_url || member.user?.avatar_url || null;
}

/**
 * 1-2 letter initials derived from the best available name.
 */
export function memberInitials(member: CompanyUserWithProfile): string {
  const name =
    member.display_name?.trim()    ||
    member.user?.full_name?.trim() ||
    "";
  return (
    name
      .split(" ")
      .filter(Boolean)
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

// ─── Legacy helpers (kept for call-sites that pass the nested user object) ────

/**
 * @deprecated Prefer memberDisplayName(member) — it uses the cached fallback.
 */
export function safeUserName(
  user: Pick<User, "full_name"> | null | undefined,
  fallback = "—",
): string {
  return user?.full_name?.trim() || fallback;
}

/**
 * @deprecated Prefer memberInitials(member) — it uses the cached fallback.
 */
export function safeUserInitials(
  user: Pick<User, "full_name"> | null | undefined,
): string {
  return (
    (user?.full_name ?? "")
      .split(" ")
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

// ─── Payload types ────────────────────────────────────────────────────────────

export interface CompanyUserUpdate {
  role?:            UserRole;
  color?:           string;
  emp_id?:          string | null;
  region?:          string | null;
  status?:          "active" | "inactive";
  // Cached display overrides (migration 011)
  display_name?:    string | null;
  display_email?:   string | null;
  avatar_url?:      string | null;
  last_mobile_sync?: string | null;
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
