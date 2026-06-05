import { createClient } from "@/lib/supabase/client";

/**
 * Returns the current authenticated user's company_id.
 *
 * Resolution strategy:
 *   1. Confirm the session is live via supabase.auth.getUser() (never trust
 *      the local JWT alone for security-sensitive reads).
 *   2. Look up company_users for that user_id to obtain company_id.
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
    .single();

  if (error || !data?.company_id) {
    throw new Error("Company not found for current user");
  }

  return data.company_id;
}
