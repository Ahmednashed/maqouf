import { z } from "zod";
import type { ToolContext } from "../types";
import { MAX_TOOL_ROWS } from "../config";

export const missingVisitsArgs = z.object({}).strict();

interface ScheduleRow {
  merch_id:   string;
  place_id:   string;
  start_time: string;
  place: { branch_ar: string; branch_en: string } | null;
  merch: { display_name: string | null; user: { full_name: string } | null } | null;
}

/**
 * Branches that SHOULD be visited today according to the recurring weekly
 * schedule, but have no visit row for the operating date.
 */
export async function getMissingVisits(ctx: ToolContext) {
  const { supabase, date, locale } = ctx;

  // day_of_week enum uses JS convention: '0' = Sunday … '6' = Saturday
  const dow = String(new Date(date + "T00:00:00Z").getUTCDay());

  const [schedRes, visitsRes] = await Promise.all([
    supabase
      .from("schedules")
      .select(`
        merch_id, place_id, start_time,
        place: places (branch_ar, branch_en),
        merch: company_users (display_name, user:users!company_users_user_id_fkey (full_name))
      `)
      .eq("is_active", true)
      .eq("day_of_week", dow)
      .limit(100),
    supabase
      .from("visits")
      .select("merch_id, place_id")
      .eq("scheduled_date", date),
  ]);

  if (schedRes.error)  throw schedRes.error;
  if (visitsRes.error) throw visitsRes.error;

  const covered = new Set(
    (visitsRes.data ?? []).map((v) => `${v.merch_id}:${v.place_id}`)
  );

  const scheduled = (schedRes.data ?? []) as unknown as ScheduleRow[];
  const missing   = scheduled.filter((s) => !covered.has(`${s.merch_id}:${s.place_id}`));

  return {
    date,
    scheduled_today: scheduled.length,
    missing_count: missing.length,
    missing: missing.slice(0, MAX_TOOL_ROWS).map((s) => ({
      branch: locale === "ar" ? s.place?.branch_ar : s.place?.branch_en,
      merchandiser: s.merch?.display_name ?? s.merch?.user?.full_name ?? null,
      planned_start: s.start_time,
    })),
  };
}
