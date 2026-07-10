import { z } from "zod";
import type { ToolContext } from "../types";
import { makeSource } from "../sources";
import { MAX_TOOL_ROWS } from "../config";

export const scheduleDetailsArgs = z.object({
  user_name:  z.string().min(1).max(60).optional(),
  place_name: z.string().min(1).max(60).optional(),
}).strict();

type Args = z.infer<typeof scheduleDetailsArgs>;

interface Row {
  id:          string;
  day_of_week: string;   // '0'..'6' (0 = Sunday, JS convention)
  start_time:  string;
  end_time:    string | null;
  is_active:   boolean;
  place: { branch_ar: string; branch_en: string } | null;
  merch: { display_name: string | null; user: { full_name: string } | null } | null;
}

const norm = (s: string) => s.trim().toLowerCase();

/** Weekly recurring schedule, optionally narrowed by member or branch name. */
export async function getScheduleDetails(ctx: ToolContext, args: Args) {
  const { data, error } = await ctx.supabase
    .from("schedules")
    .select(`
      id, day_of_week, start_time, end_time, is_active,
      place:places (branch_ar, branch_en),
      merch:company_users (display_name, user:users!company_users_user_id_fkey (full_name))
    `)
    .eq("is_active", true)
    .order("day_of_week")
    .limit(100);

  if (error) throw error;

  let rows = (data ?? []) as unknown as Row[];

  if (args.user_name) {
    const q = norm(args.user_name);
    rows = rows.filter((r) =>
      norm(r.merch?.display_name ?? r.merch?.user?.full_name ?? "").includes(q)
    );
  }
  if (args.place_name) {
    const q = norm(args.place_name);
    rows = rows.filter((r) =>
      norm(r.place?.branch_ar ?? "").includes(q) || norm(r.place?.branch_en ?? "").includes(q)
    );
  }

  const shown = rows.slice(0, MAX_TOOL_ROWS);
  const src = shown[0] ? makeSource("schedule", shown[0].id, "schedule") : null;

  return {
    count: rows.length,
    truncated: rows.length > shown.length,
    entries: shown.map((r) => ({
      day: Number(r.day_of_week),   // 0 = Sunday … 6 = Saturday
      start: r.start_time,
      end:   r.end_time ?? undefined,
      branch: ctx.locale === "ar" ? r.place?.branch_ar : r.place?.branch_en,
      merchandiser: r.merch?.display_name ?? r.merch?.user?.full_name ?? null,
    })),
    __sources: src ? [src] : [],
  };
}
