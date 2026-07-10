import { z } from "zod";
import type { ToolContext } from "../types";
import type { ToolEntity } from "../entity-state";
import { makeSource } from "../sources";

export const visitDetailsArgs = z.object({
  visit_id: z.string().uuid(),
}).strict();

type Args = z.infer<typeof visitDetailsArgs>;

interface Row {
  id:               string;
  status:           string;
  scheduled_date:   string;
  started_at:       string | null;
  completed_at:     string | null;
  duration_minutes: number | null;
  notes:            string | null;
  checkin_verified: boolean | null;
  checkin_distance_meters: number | null;
  place: { id: string; branch_ar: string; branch_en: string; region: string | null } | null;
  merch: { id: string; display_name: string | null; user: { full_name: string } | null } | null;
}

/** Full detail for one visit (RLS guarantees it belongs to the caller's company). */
export async function getVisitDetails(ctx: ToolContext, args: Args) {
  const { data, error } = await ctx.supabase
    .from("visits")
    .select(`
      id, status, scheduled_date, started_at, completed_at, duration_minutes,
      notes, checkin_verified, checkin_distance_meters,
      place:places (id, branch_ar, branch_en, region),
      merch:company_users (id, display_name, user:users!company_users_user_id_fkey (full_name))
    `)
    .eq("id", args.visit_id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return { found: false };

  const v = data as unknown as Row;
  const branch = ctx.locale === "ar" ? v.place?.branch_ar : v.place?.branch_en;
  const merch  = v.merch?.display_name ?? v.merch?.user?.full_name ?? null;

  const sources = [
    makeSource("visit", v.id, branch ?? v.id, v.scheduled_date),
    v.place ? makeSource("place", v.place.id, branch ?? "") : null,
  ].filter(Boolean);

  const entities: ToolEntity[] = [{
    kind:       "visit",
    id:         v.id,
    label:      branch ?? v.id.slice(0, 8),
    confidence: 1,
    userId:     v.merch?.id,
    userLabel:  merch ?? undefined,
    placeId:    v.place?.id,
    placeLabel: branch ?? undefined,
    date:       v.scheduled_date,
    status:     v.status,
  }];

  return {
    found: true,
    __entities: entities,
    visit: {
      branch,
      region: v.place?.region ?? undefined,
      merchandiser: merch,
      status: v.status,
      scheduled_date: v.scheduled_date,
      started_at: v.started_at,
      completed_at: v.completed_at,
      duration_min: v.duration_minutes ?? undefined,
      gps_verified: v.checkin_verified,
      gps_distance_m: v.checkin_distance_meters ?? undefined,
      notes: v.notes?.slice(0, 200) ?? undefined,
    },
    __sources: sources,
  };
}
