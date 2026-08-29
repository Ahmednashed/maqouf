import { createClient } from "@/lib/supabase/client";
import type { VisitStatus } from "@/types";

// ─────────────────────────────────────────────────────────────────────────────
// Team workload — what each member is actually responsible for.
//
// The Users screen could previously answer "who is on the team" but not
// "who is doing anything". Both facts already exist in the schema and are
// keyed by company_users.id:
//
//   visits.merch_id          UUID REFERENCES company_users(id)
//   places.assigned_user_id  UUID REFERENCES company_users(id)
//
// so no migration is involved — this is two aggregate reads, reduced in
// memory, in the shape fetchPlaceOperations() already established. It is
// deliberately NOT a per-row lookup: a 40-person team must stay two queries.
// ─────────────────────────────────────────────────────────────────────────────

export interface TeamWorkload {
  /** Visits scheduled to this member for the requested day. */
  visits_today:      number;
  /** Of those, the ones already finished. */
  completed_today:   number;
  /** Of those, the ones still open (pending or in progress). */
  open_today:        number;
  /** Active branches where this member is the assigned merchandiser. */
  assigned_branches: number;
}

export function blankWorkload(): TeamWorkload {
  return {
    visits_today:      0,
    completed_today:   0,
    open_today:        0,
    assigned_branches: 0,
  };
}

interface VisitRow  { merch_id: string; status: VisitStatus }
interface PlaceRow  { assigned_user_id: string | null }

/**
 * Workload for every member, keyed by `company_users.id`.
 *
 * `date` is a Riyadh business day ("YYYY-MM-DD"), matching how
 * `visits.scheduled_date` is stored — a timezone-less DATE. Callers pass
 * riyadhToday() rather than a locally-derived day so this agrees with the
 * dashboard and the visits calendar.
 *
 * Members with no visits and no branches are simply absent from the map;
 * callers should fall back to blankWorkload(). That absence is meaningful —
 * it is exactly the "has nothing assigned" case the screen needs to show.
 */
export async function fetchTeamWorkload(
  date: string,
): Promise<Record<string, TeamWorkload>> {
  const supabase = createClient();

  const [visitsRes, placesRes] = await Promise.all([
    supabase
      .from("visits")
      .select("merch_id, status")
      .eq("scheduled_date", date),
    // Inactive branches are excluded: an assignment to a closed branch is not
    // work anybody is expected to do, and counting it would overstate load.
    supabase
      .from("places")
      .select("assigned_user_id")
      .eq("is_active", true),
  ]);

  if (visitsRes.error) throw visitsRes.error;
  if (placesRes.error) throw placesRes.error;

  const map: Record<string, TeamWorkload> = {};

  for (const v of (visitsRes.data ?? []) as VisitRow[]) {
    const row = (map[v.merch_id] ??= blankWorkload());
    row.visits_today += 1;
    if (v.status === "completed") row.completed_today += 1;
    // "missed" is neither completed nor still open — it is a closed failure,
    // so it counts toward the day's total but toward neither sub-count.
    if (v.status === "pending" || v.status === "inprogress") row.open_today += 1;
  }

  for (const p of (placesRes.data ?? []) as PlaceRow[]) {
    if (!p.assigned_user_id) continue;
    const row = (map[p.assigned_user_id] ??= blankWorkload());
    row.assigned_branches += 1;
  }

  return map;
}
