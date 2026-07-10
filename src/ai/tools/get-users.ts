import { z } from "zod";
import type { ToolContext } from "../types";

export const usersArgs = z.object({
  status: z.enum(["active", "inactive", "all"]).optional(),
}).strict();

type Args = z.infer<typeof usersArgs>;

const MAX_USERS = 30;

interface Row {
  display_name:     string | null;
  role:             string;
  region:           string | null;
  status:           string;
  last_activity_at: string | null;
  last_mobile_sync: string | null;
  user: { full_name: string } | null;
}

/**
 * Company team roster. Names, roles, regions, activity — deliberately NO
 * emails or phone numbers (the model doesn't need personal contact data).
 */
export async function getUsers(ctx: ToolContext, args: Args) {
  const { supabase } = ctx;
  const status = args.status ?? "all";

  let query = supabase
    .from("company_users")
    .select(`
      display_name, role, region, status, last_activity_at, last_mobile_sync,
      user:users!company_users_user_id_fkey (full_name)
    `)
    .order("last_activity_at", { ascending: false, nullsFirst: false })
    .limit(MAX_USERS);

  if (status !== "all") query = query.eq("status", status);

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as unknown as Row[];
  return {
    count: rows.length,
    truncated: rows.length === MAX_USERS,
    members: rows.map((r) => ({
      name: r.display_name ?? r.user?.full_name ?? "—",
      role: r.role,
      region: r.region ?? undefined,
      status: r.status,
      last_activity: r.last_activity_at,
      last_sync: r.last_mobile_sync,
    })),
  };
}
