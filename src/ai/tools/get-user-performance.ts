import { z } from "zod";
import type { ToolContext } from "../types";
import { makeSource } from "../sources";
import { resolveMemberByName } from "./helpers";
import { aggregateWindow, type WindowVisitRow } from "../compare";

export const userPerformanceArgs = z.object({
  name: z.string().min(1).max(60),
  days: z.number().int().min(1).max(90).optional(),
}).strict();

type Args = z.infer<typeof userPerformanceArgs>;

/** Visit performance for one member over the last N days (default 7). */
export async function getUserPerformance(ctx: ToolContext, args: Args) {
  const days = args.days ?? 7;

  const { match, candidates } = await resolveMemberByName(ctx, args.name);
  if (!match) {
    return {
      found: false,
      ambiguous: candidates.length > 1,
      candidates: candidates.map((c) => ({ name: c.name, role: c.role })),
    };
  }

  const from = new Date(ctx.date + "T00:00:00Z");
  from.setUTCDate(from.getUTCDate() - days + 1);
  const fromDate = from.toISOString().slice(0, 10);

  const { data, error } = await ctx.supabase
    .from("visits")
    .select("status, duration_minutes, started_at, checkin_verified, merch_id")
    .eq("merch_id", match.id)
    .gte("scheduled_date", fromDate)
    .lte("scheduled_date", ctx.date);

  if (error) throw error;

  const metrics = aggregateWindow((data ?? []) as WindowVisitRow[]);
  const src = makeSource("user", match.id, match.name);

  return {
    found: true,
    member: match.name,
    period_days: days,
    planned:          metrics.planned,
    completed:        metrics.completed,
    completion_rate_pct: metrics.completion_rate,
    missed:           metrics.missed,
    avg_duration_min: metrics.avg_duration,
    gps_verified_pct: metrics.gps_verified_rate,
    __sources: src ? [src] : [],
  };
}
