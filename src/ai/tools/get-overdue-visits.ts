import { z } from "zod";
import type { ToolContext } from "../types";
import { MAX_TOOL_ROWS } from "../config";

export const overdueVisitsArgs = z.object({
  limit: z.number().int().min(1).max(MAX_TOOL_ROWS).optional(),
}).strict();

type Args = z.infer<typeof overdueVisitsArgs>;

interface Row {
  id:             string;
  status:         string;
  scheduled_date: string;
  place: { branch_ar: string; branch_en: string } | null;
  merch: { display_name: string | null; user: { full_name: string } | null } | null;
}

/** Unfinished visits scheduled BEFORE the operating date, oldest first. */
export async function getOverdueVisits(ctx: ToolContext, args: Args) {
  const { supabase, date, locale } = ctx;
  const limit = args.limit ?? MAX_TOOL_ROWS;

  const { data, error, count } = await supabase
    .from("visits")
    .select(`
      id, status, scheduled_date,
      place:places (branch_ar, branch_en),
      merch:company_users (display_name, user:users!company_users_user_id_fkey (full_name))
    `, { count: "exact" })
    .in("status", ["pending", "inprogress"])
    .lt("scheduled_date", date)
    .order("scheduled_date", { ascending: true })
    .limit(limit);

  if (error) throw error;

  const rows = (data ?? []) as unknown as Row[];
  return {
    total_overdue: count ?? rows.length,
    shown: rows.length,
    visits: rows.map((r) => ({
      branch: locale === "ar" ? r.place?.branch_ar : r.place?.branch_en,
      merchandiser: r.merch?.display_name ?? r.merch?.user?.full_name ?? null,
      scheduled_date: r.scheduled_date,
      status: r.status,
    })),
  };
}
