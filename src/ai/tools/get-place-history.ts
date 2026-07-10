import { z } from "zod";
import type { ToolContext } from "../types";
import { makeSource } from "../sources";
import { resolvePlaceByName, placeLabel } from "./helpers";

export const placeHistoryArgs = z.object({
  place_name: z.string().min(1).max(60),
  limit:      z.number().int().min(1).max(15).optional(),
}).strict();

type Args = z.infer<typeof placeHistoryArgs>;

interface Row {
  id:             string;
  status:         string;
  scheduled_date: string;
  duration_minutes: number | null;
  merch: { display_name: string | null; user: { full_name: string } | null } | null;
}

/** Recent visit history for one branch (resolved by name, newest first). */
export async function getPlaceHistory(ctx: ToolContext, args: Args) {
  const { match, candidates } = await resolvePlaceByName(ctx, args.place_name);

  if (!match) {
    return {
      found: false,
      ambiguous: candidates.length > 1,
      candidates: candidates.map((c) => ({ name: placeLabel(c, ctx.locale), region: c.region })),
    };
  }

  const { data, error } = await ctx.supabase
    .from("visits")
    .select(`
      id, status, scheduled_date, duration_minutes,
      merch:company_users (display_name, user:users!company_users_user_id_fkey (full_name))
    `)
    .eq("place_id", match.id)
    .order("scheduled_date", { ascending: false })
    .limit(args.limit ?? 10);

  if (error) throw error;

  const rows  = (data ?? []) as unknown as Row[];
  const label = placeLabel(match, ctx.locale);
  const sources = [
    makeSource("place", match.id, label),
    ...(rows[0] ? [makeSource("visit", rows[0].id, label, rows[0].scheduled_date)] : []),
  ].filter(Boolean);

  const latest = rows[0];
  const entities = [
    { kind: "place" as const, id: match.id, label, confidence: 1 },
    ...(latest ? [{
      kind: "visit" as const,
      id: latest.id,
      label,
      confidence: 0.9,
      placeId: match.id,
      placeLabel: label,
      userLabel: latest.merch?.display_name ?? latest.merch?.user?.full_name ?? undefined,
      date: latest.scheduled_date,
      status: latest.status,
    }] : []),
  ];

  return {
    found: true,
    __entities: entities,
    branch: label,
    region: match.region ?? undefined,
    visit_count_shown: rows.length,
    visits: rows.map((r) => ({
      date:   r.scheduled_date,
      status: r.status,
      merchandiser: r.merch?.display_name ?? r.merch?.user?.full_name ?? null,
      duration_min: r.duration_minutes ?? undefined,
    })),
    __sources: sources,
  };
}
