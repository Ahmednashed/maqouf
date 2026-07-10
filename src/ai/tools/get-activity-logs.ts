import { z } from "zod";
import type { ToolContext } from "../types";
import { MAX_TOOL_ROWS } from "../config";

export const activityLogsArgs = z.object({
  limit: z.number().int().min(1).max(MAX_TOOL_ROWS).optional(),
}).strict();

type Args = z.infer<typeof activityLogsArgs>;

/** Most recent audit-trail events (visit lifecycle + user management). */
export async function getActivityLogs(ctx: ToolContext, args: Args) {
  const { supabase } = ctx;
  const limit = args.limit ?? MAX_TOOL_ROWS;

  const { data, error } = await supabase
    .from("activity_logs")
    .select("action, actor_name, entity_type, entity_label, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    // Pre-migration deployments: table may not exist yet — degrade, don't fail
    if (error.code === "42P01" || error.code === "PGRST205") {
      return { available: false, events: [] };
    }
    throw error;
  }

  return {
    available: true,
    count: (data ?? []).length,
    events: (data ?? []).map((r) => ({
      action: r.action,
      actor: r.actor_name ?? "system",
      entity: r.entity_label ?? r.entity_type,
      at: r.created_at,
    })),
  };
}
