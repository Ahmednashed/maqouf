import { z } from "zod";
import type { ToolContext } from "../types";
import { MAX_TOOL_ROWS } from "../config";

export const syncIssuesArgs = z.object({}).strict();

const SYNC_STALE_MS = 24 * 60 * 60 * 1000;

interface Row {
  display_name:     string | null;
  region:           string | null;
  last_mobile_sync: string | null;
  last_activity_at: string | null;
  user: { full_name: string } | null;
}

/** Active members whose mobile app hasn't synced in 24h (or ever). */
export async function getSyncIssues(ctx: ToolContext) {
  const { supabase } = ctx;

  const { data, error } = await supabase
    .from("company_users")
    .select(`
      display_name, region, last_mobile_sync, last_activity_at,
      user:users!company_users_user_id_fkey (full_name)
    `)
    .eq("status", "active");

  if (error) throw error;

  const now  = Date.now();
  const rows = (data ?? []) as unknown as Row[];
  const stale = rows.filter((r) =>
    !r.last_mobile_sync || now - new Date(r.last_mobile_sync).getTime() > SYNC_STALE_MS
  );

  return {
    team_size: rows.length,
    with_sync_issues: stale.length,
    members: stale.slice(0, MAX_TOOL_ROWS).map((r) => ({
      name: r.display_name ?? r.user?.full_name ?? "—",
      region: r.region ?? undefined,
      last_sync: r.last_mobile_sync,          // null = never synced
      last_activity: r.last_activity_at,
    })),
  };
}
