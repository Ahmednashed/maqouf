import type { VisitProductPlan, VisitFieldPlan } from "@/lib/visit-plan";
import { gpsCheckState, branchHasCoords, type GpsCheckSource } from "@/lib/gps-status";

// ─────────────────────────────────────────────────────────────────────────────
// What a visit would be hiding if it were completed right now.
//
// The complete modal counted one thing: products whose recorded quantity fell
// below the branch minimum. That number is real, but it answers a different
// question, and it has the wrong shape for a guardrail — it can only be
// non-zero once someone has actually counted something. A visit where nothing
// was checked at all produced a warning of zero, so the dialog was quietest
// exactly when the least work had been done.
//
// Template answers were not consulted at all: a visit could be completed with
// every required field blank and the confirmation would not mention it.
//
// This composes the Batch 8 plans and the Batch 9 GPS state rather than
// re-deriving any of it, so "required", "checked" and "verified" keep meaning
// here what they mean on the rest of the page.
// ─────────────────────────────────────────────────────────────────────────────

export type GpsReadiness =
  | "verified"
  | "outside"
  | "not_recorded"
  /**
   * The branch has no coordinates, so no check-in could ever have validated.
   * Reported apart from `not_recorded` because it is a branch-setup gap, not
   * something the person completing the visit failed to do.
   */
  | "not_applicable";

export type ReadinessKind =
  | "required_fields"
  | "required_products"
  | "unchecked_products"
  | "gps_missing";

export interface ReadinessGap {
  kind:  ReadinessKind;
  /** How many of that thing are outstanding; 1 for the singular GPS gap. */
  count: number;
}

export interface VisitReadiness {
  /** No outstanding required work. GPS alone never makes a visit unready. */
  ready:                   boolean;
  missingRequiredFields:   number;
  missingRequiredProducts: number;
  uncheckedProducts:       number;
  gps:                     GpsReadiness;
  /** Only the non-empty gaps, in the order they should be read. */
  gaps:                    ReadinessGap[];
  /** Products whose recorded quantity is under the branch minimum. */
  belowMinCount:           number;
}

export interface ReadinessInput {
  productPlan: VisitProductPlan;
  /** null when the visit carries no template. */
  fieldPlan:   VisitFieldPlan | null;
  visit:       GpsCheckSource & { place?: { lat?: number | null; lng?: number | null } | null };
}

/**
 * Readiness of a visit for completion.
 *
 * `ready` deliberately ignores GPS. A position cannot be captured after the
 * fact, and at a branch with no coordinates it could never have been captured
 * at all, so treating it as outstanding work would make some visits
 * permanently un-completable for a reason nobody on site can fix. It is still
 * reported, so the record stays honest about what is and is not known.
 */
export function deriveVisitReadiness({
  productPlan, fieldPlan, visit,
}: ReadinessInput): VisitReadiness {
  const missingRequiredFields = fieldPlan?.missingRequired.length ?? 0;

  // Mandatory assortment products that were never counted. Reads off the
  // Batch 8 plan, so a seeded row with a null quantity is correctly still
  // outstanding rather than counted as done.
  const missingRequiredProducts =
    productPlan.mandatoryCount - productPlan.mandatoryCheckedCount;

  const uncheckedProducts = productPlan.expectedCount - productPlan.checkedCount;

  const gps: GpsReadiness = !branchHasCoords(visit.place)
    ? "not_applicable"
    : gpsCheckState(visit);

  const gaps: ReadinessGap[] = [];
  if (missingRequiredFields > 0)   gaps.push({ kind: "required_fields",   count: missingRequiredFields });
  if (missingRequiredProducts > 0) gaps.push({ kind: "required_products", count: missingRequiredProducts });
  // Only worth saying separately when it is more than the required shortfall
  // already named above — otherwise it restates the same products.
  const extraUnchecked = uncheckedProducts - missingRequiredProducts;
  if (extraUnchecked > 0)          gaps.push({ kind: "unchecked_products", count: extraUnchecked });
  if (gps === "not_recorded")      gaps.push({ kind: "gps_missing",        count: 1 });

  return {
    ready: missingRequiredFields === 0 && missingRequiredProducts === 0 && uncheckedProducts === 0,
    missingRequiredFields,
    missingRequiredProducts,
    uncheckedProducts,
    gps,
    gaps,
    belowMinCount: productPlan.belowMinCount,
  };
}

/** True when completing now would leave required work unrecorded. */
export function hasRequiredGaps(r: VisitReadiness): boolean {
  return r.missingRequiredFields > 0 || r.missingRequiredProducts > 0;
}
