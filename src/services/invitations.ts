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
