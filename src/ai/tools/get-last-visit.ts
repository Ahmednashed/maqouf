import { z } from "zod";
import type { ToolContext } from "../types";
import type { ToolEntity } from "../entity-state";
import { makeSource } from "../sources";
import { resolveMemberByName } from "./helpers";

export const lastVisitArgs = z.object({
  user_name: z.string().min(1).max(60).nullish(),
}).strict();

type Args = z.infer<typeof lastVisitArgs>;

interface Row {
  id:               string;
  status:           string;
  scheduled_date:   string;
  started_at:       string | null;
  completed_at:     string | null;
  duration_minutes: number | null;
  merch_id:         string;
  place: { id: string; branch_ar: string; branch_en: string } | null;
  merch: { id: string; display_name: string | null; user: { full_name: string } | null } | null;
}

/**
 * The most recent visit — company-wide, or for one member when user_name is
 * given. Grounds activeVisit + activeUser + activePlace for follow-ups
 * ("did they upload photos?", "which products?", "show the timeline").
 */
export async function getLastVisit(ctx: ToolContext, args: Args) {
  let merchId: string | null = null;
  if (args.user_name) {
    const { match, candidates } = await resolveMemberByName(ctx, args.user_name);
    if (!match) {
      return {
        found: false,
        ambiguous: candidates.length > 1,
        candidates: candidates.map((c) => ({ name: c.name, role: c.role })),
      };
    }
    merchId = match.id;
  }

  let query = ctx.supabase
    .from("visits")
    .select(`
      id, status, scheduled_date, started_at, completed_at, duration_minutes, merch_id,
      place:places (id, branch_ar, branch_en),
      merch:company_users (id, display_name, user:users!company_users_user_id_fkey (full_name))
    `)
    .not("started_at", "is", null)
    .order("started_at", { ascending: false })
    .limit(1);

  if (merchId) query = query.eq("merch_id", merchId);

  let { data, error } = await query.maybeSingle();
  if (error) throw error;

  // No started visit → fall back to the latest scheduled one
  if (!data) {
    let fallback = ctx.supabase
      .from("visits")
      .select(`
        id, status, scheduled_date, started_at, completed_at, duration_minutes, merch_id,
        place:places (id, branch_ar, branch_en),
        merch:company_users (id, display_name, user:users!company_users_user_id_fkey (full_name))
      `)
      .order("scheduled_date", { ascending: false })
      .limit(1);
    if (merchId) fallback = fallback.eq("merch_id", merchId);
    const res = await fallback.maybeSingle();
    if (res.error) throw res.error;
    data = res.data;
  }

  if (!data) return { found: false, ambiguous: false, candidates: [] };

  const v          = data as unknown as Row;
  const branch     = ctx.locale === "ar" ? v.place?.branch_ar : v.place?.branch_en;
  const merchName  = v.merch?.display_name ?? v.merch?.user?.full_name ?? null;

  const entities: ToolEntity[] = [{
    kind:       "visit",
    id:         v.id,
    label:      branch ?? v.id.slice(0, 8),
    confidence: 1,
    userId:     v.merch?.id,
    userLabel:  merchName ?? undefined,
    placeId:    v.place?.id,
    placeLabel: branch ?? undefined,
    date:       v.scheduled_date,
    status:     v.status,
  }];

  const sources = [
    makeSource("visit", v.id, branch ?? v.id.slice(0, 8), v.scheduled_date),
    v.place ? makeSource("place", v.place.id, branch ?? "") : null,
    v.merch && merchName ? makeSource("user", v.merch.id, merchName) : null,
  ].filter(Boolean);

  return {
    found: true,
    visit: {
      visit_id: v.id,       // exposed so the model can chain into visit tools
      branch,
      merchandiser: merchName,
      status: v.status,
      scheduled_date: v.scheduled_date,
      started_at: v.started_at,
      completed_at: v.completed_at,
      duration_min: v.duration_minutes ?? undefined,
    },
    __sources:  sources,
    __entities: entities,
  };
}
