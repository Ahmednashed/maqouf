import { createClient } from "@/lib/supabase/client";
import type { UserRole } from "@/types";

// ─── Payload ──────────────────────────────────────────────────────────────────

export interface InvitePayload {
  email:   string;
  role:    UserRole;
  color?:  string;
  emp_id?: string;
  region?: string;
}

// ─── Result ───────────────────────────────────────────────────────────────────

/**
 * The three outcomes the Edge Function can return (all are non-error):
 *
 *  "invited"        — new user; invite email sent; they'll join on acceptance.
 *  "added"          — user already had an account; added to company directly.
 *  "already_member" — user was already a member; no change made.
 */
export type InviteStatus = "invited" | "added" | "already_member";

export interface InviteResult {
  status:  InviteStatus;
  message: string;
}

// ─── Pending invitations (read) ───────────────────────────────────────────────

/** A `company_user_invitations` row that has not been accepted yet. */
export interface PendingInvitation {
  id:         string;
  email:      string;
  role:       UserRole;
  emp_id:     string | null;
  region:     string | null;
  created_at: string;
}

/**
 * Invitations that were emailed but never accepted (`accepted_at IS NULL`).
 *
 * These people do NOT have a `company_users` row yet — the `handle_new_user`
 * trigger creates it when they complete signup — so they must be surfaced
 * separately from the members table rather than shown as Active.
 *
 * RLS (migration 007 `invitations_select`) already restricts this to
 * owner/admin of the company, so no extra filtering is needed here.
 *
 * The Edge Function inserts a NEW row on every invite (including resends),
 * so rows are deduplicated by email, keeping the most recent one.
 */
export async function fetchPendingInvitations(): Promise<PendingInvitation[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("company_user_invitations")
    .select("id, email, role, emp_id, region, created_at")
    .is("accepted_at", null)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const seen = new Set<string>();
  return ((data ?? []) as PendingInvitation[]).filter((row) => {
    const key = row.email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Edge Function caller ─────────────────────────────────────────────────────

/**
 * Invite a user to the current company by email.
 *
 * Calls the `invite-company-user` Supabase Edge Function, which:
 *   • validates the caller is owner/admin (server-side, from JWT)
 *   • derives company_id from the DB (never from the request body)
 *   • uses the service_role key to call inviteUserByEmail() safely
 *
 * Throws on validation errors (invalid email, permission denied, etc.)
 * Returns an InviteResult for the three non-error outcomes.
 */
export async function inviteCompanyUser(payload: InvitePayload): Promise<InviteResult> {
  const supabase = createClient();

  // supabase.functions.invoke() automatically forwards the current
  // session's Authorization header, so the Edge Function can verify
  // the caller's identity without the browser ever seeing the service key.
  const { data, error } = await supabase.functions.invoke<InviteResult>(
    "invite-company-user",
    { body: payload }
  );

  if (error) {
    // The Edge Function returns JSON error bodies for 4xx/5xx responses.
    // FunctionsHttpError.message is the raw response text — try to parse it.
    let message: string = error.message;
    try {
      const parsed = JSON.parse(message) as { message?: string };
      if (parsed.message) message = parsed.message;
    } catch {
      // Not JSON — use the raw string as-is.
    }
    throw new Error(message);
  }

  if (!data) throw new Error("No response from server.");
  return data;
}
