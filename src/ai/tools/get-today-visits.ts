import { z } from "zod";
import type { ToolContext } from "../types";
import { MAX_TOOL_ROWS } from "../config";

export const todayVisitsArgs = z.object({
  status: z.enum(["pending", "inprogress", "completed", "missed"]).optional(),
  limit:  z.number().int().min(1).max(MAX_TOOL_ROWS).optional(),
}).strict();

type Args = z.infer<typeof todayVisitsArgs>;

interface Row {
  id:             string;
  status:         string;
  started_at:     string | null;
  completed_at:   string | null;
  duration_minutes: number | null;
  place: { branch_ar: string; branch_en: string } | null;
  merch: { display_name: string | null; user: { full_name: string } | null } | null;
}

/** Visits scheduled on the operating date, optionally filtered by status. */
export async function getTodayVisits(ctx: ToolContext, args: Args) {
  const { supabase, date, locale } = ctx;
  const limit = args.limit ?? MAX_TOOL_ROWS;

  let query = supabase
    .from("visits")
    .select(`
      id, status, started_at, completed_at, duration_minutes,
      place:places (branch_ar, branch_en),
      merch:company_users (display_name, user:users!company_users_user_id_fkey (full_name))
    `)
    .eq("scheduled_date", date)
    .order("status")
    .limit(limit);

  if (args.status) query = query.eq("status", args.status);

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as unknown as Row[];
  return {
    date,
    count: rows.length,
    truncated: rows.length === limit,
    visits: rows.map((r) => ({
      branch: locale === "ar" ? r.place?.branch_ar : r.place?.branch_en,
      merchandiser: r.merch?.display_name ?? r.merch?.user?.full_name ?? null,
      status: r.status,
      started_at: r.started_at,
      duration_min: r.duration_minutes ?? undefined,
    })),
  };
}
