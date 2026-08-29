import {
  occurrencesFor,
  dayOfWeek,
  addDays,
  type Frequency,
  type DayOfWeek,
} from "@/lib/recurrence";
import { branchHasCoords } from "@/lib/gps-status";
import { daysSinceIso } from "@/services/places";

// ─────────────────────────────────────────────────────────────────────────────
// What the app already knows about a branch and a recurrence, gathered for the
// moment of scheduling.
//
// Picking a branch in the create modal told you nothing: not who owns it, not
// whether it has an assortment to check, not whether it has coordinates, not
// when anyone was last there. All four facts were already on screen elsewhere
// — /places shows every one of them — so the scheduler was the only place
// working blind.
//
// Pure. Both inputs are already fetched by the modal (usePlaces,
// usePlaceOperations), so nothing here adds a query.
// ─────────────────────────────────────────────────────────────────────────────

export interface BranchLike {
  id:                string;
  lat?:              number | null;
  lng?:              number | null;
  assigned_user_id?: string | null;
}

export interface OpsLike {
  last_visit_date: string | null;
  product_count:   number;
  required_count:  number;
}

export interface BranchContext {
  hasCoords:       boolean;
  hasAssortment:   boolean;
  productCount:    number;
  requiredCount:   number;
  lastVisitDate:   string | null;
  /** Whole days since the last visit; null when never visited. */
  daysSinceVisit:  number | null;
  assignedUserId:  string | null;
}

/**
 * `ops` is undefined while the roll-up is still loading, which is different
 * from a branch that genuinely has no assortment. Callers get zeroes either
 * way, so they must not render "no assortment" until the query resolves —
 * `hasAssortment` alone cannot distinguish the two.
 */
export function branchContext(
  place: BranchLike,
  ops:   OpsLike | undefined,
  todayIso: string,
): BranchContext {
  const lastVisitDate = ops?.last_visit_date ?? null;
  return {
    hasCoords:      branchHasCoords(place),
    hasAssortment:  (ops?.product_count ?? 0) > 0,
    productCount:   ops?.product_count  ?? 0,
    requiredCount:  ops?.required_count ?? 0,
    lastVisitDate,
    daysSinceVisit: daysSinceIso(lastVisitDate, todayIso),
    assignedUserId: place.assigned_user_id ?? null,
  };
}

/**
 * True when a visit is being assigned to someone other than the branch's
 * own merchandiser. Not an error — covering for a colleague is ordinary —
 * so callers should inform, never block.
 *
 * A branch with nobody assigned cannot mismatch.
 */
export function isMerchMismatch(
  assignedUserId: string | null,
  chosenMerchId:  string,
): boolean {
  return Boolean(assignedUserId) && Boolean(chosenMerchId) && assignedUserId !== chosenMerchId;
}

// ─── Recurrence preview ───────────────────────────────────────────────────────

export interface RecurrencePreview {
  /** Weekday the series lands on, derived from the first date. */
  dayOfWeek: DayOfWeek;
  /** The next dates that would actually be created, anchor first. */
  dates:     string[];
}

/** How far ahead to look for preview dates. Four months covers monthly. */
const PREVIEW_HORIZON_DAYS = 130;

/**
 * The dates a recurring choice would really produce.
 *
 * Runs the SAME generator the daily job and reconciler use
 * (`occurrencesFor`), anchored the same way the planner anchors it —
 * anchor_date is the chosen first date verbatim, and day_of_week is derived
 * from it rather than asked for separately. A preview computed any other way
 * could describe a series the system would not create.
 */
export function previewOccurrences(
  firstDate: string,
  frequency: Frequency,
  count = 3,
): RecurrencePreview | null {
  if (!firstDate) return null;
  const dow = dayOfWeek(firstDate);
  const dates = occurrencesFor(
    { anchorDate: firstDate, dayOfWeek: dow, frequency },
    firstDate,
    addDays(firstDate, PREVIEW_HORIZON_DAYS),
  ).slice(0, count);
  return { dayOfWeek: dow, dates };
}
