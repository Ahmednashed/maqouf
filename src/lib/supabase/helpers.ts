import { createClient } from "@/lib/supabase/client";

/**
 * Returns the current authenticated user's company_id.
 *
 * Resolution strategy:
 *   1. Confirm the session is live via supabase.auth.getUser() (never trust
 *      the local JWT alone for security-sensitive reads).
 *   2. Look up the ACTIVE company_users row for that user_id — the same
 *      resolution useCurrentMember applies (active membership, oldest
 *      first), so both always agree on which company "mine" is, and users
 *      with several memberships don't make `.single()` throw.
 *
 * Throws a descriptive error so callers surface a useful message in the UI
 * instead of a generic "undefined" crash.
 */
export async function getMyCompanyId(): Promise<string> {
  const supabase = createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error("User not authenticated");
  }

  const { data, error } = await supabase
    .from("company_users")
    .select("company_id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data?.company_id) {
    throw new Error("Company not found for current user");
  }

  return data.company_id;
}
