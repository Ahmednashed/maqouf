import { z } from "zod";
import type { ToolContext } from "../types";
import { makeSource } from "../sources";

export const visitTimelineArgs = z.object({
  visit_id: z.string().uuid(),
}).strict();

type Args = z.infer<typeof visitTimelineArgs>;

/** Audit-trail events for one visit (created → started → completed …). */
export async function getVisitTimeline(ctx: ToolContext, args: Args) {
  const { data, error } = await ctx.supabase
    .from("activity_logs")
    .select("action, actor_name, entity_label, created_at")
    .eq("entity_type", "visit")
    .eq("entity_id", args.visit_id)
    .order("created_at", { ascending: true })
    .limit(20);

  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") {
      return { available: false, events: [] };
    }
    throw error;
  }

  const rows = data ?? [];
  const label = rows[0]?.entity_label ?? args.visit_id;
  const src = makeSource("visit", args.visit_id, label);

  return {
    available: true,
    count: rows.length,
    events: rows.map((r) => ({
      action: r.action,
      actor:  r.actor_name ?? "system",
      at:     r.created_at,
    })),
    __sources: src ? [src] : [],
  };
}
