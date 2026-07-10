import { z } from "zod";
import type { ToolContext } from "../types";
import { MAX_TOOL_ROWS } from "../config";

export const unvisitedPlacesArgs = z.object({}).strict();

/** Active branches that have NO visit scheduled on the operating date. */
export async function getUnvisitedPlaces(ctx: ToolContext) {
  const { supabase, date, locale } = ctx;

  const [placesRes, visitsRes] = await Promise.all([
    supabase
      .from("places")
      .select("id, branch_ar, branch_en, region")
      .eq("is_active", true),
    supabase
      .from("visits")
      .select("place_id")
      .eq("scheduled_date", date),
  ]);

  if (placesRes.error) throw placesRes.error;
  if (visitsRes.error) throw visitsRes.error;

  const visited   = new Set((visitsRes.data ?? []).map((v) => v.place_id));
  const places    = placesRes.data ?? [];
  const unvisited = places.filter((p) => !visited.has(p.id));

  return {
    date,
    total_active_branches: places.length,
    unvisited_count: unvisited.length,
    truncated: unvisited.length > MAX_TOOL_ROWS,
    branches: unvisited.slice(0, MAX_TOOL_ROWS).map((p) => ({
      name: locale === "ar" ? p.branch_ar : p.branch_en,
      region: p.region ?? undefined,
    })),
  };
}
