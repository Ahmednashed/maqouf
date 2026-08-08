// ─────────────────────────────────────────────────────────────────────────────
// Reconciliation planning — pure, deterministic, unit-tested.
//
// When a schedule is edited (weekday, frequency, anchor, template) the visits
// already generated from it can no longer match the new rule. This module
// decides WHAT should happen; it never touches the database.
//
// Safety model — two independent gates, both must pass before a row is
// touched:
//   1. THIS module only ever proposes ids the caller supplied as untouched.
//      The caller reads them from v_untouched_generated_visits (migration
//      020), which excludes anything started, completed, missed, noted,
//      checked-in, product-audited or checklist-answered.
//   2. The caller applies a strict future-date cut (scheduled_date > today,
//      Riyadh) before proposing anything.
//
// A row that fails either gate is classified `protected` and is reported but
// never modified.
// ─────────────────────────────────────────────────────────────────────────────

/** An already-generated visit as seen by the reconciler. */
export interface ExistingGeneratedVisit {
  id:             string;
  scheduled_date: string;          // "YYYY-MM-DD"
  template_id:    string | null;
  /** True only when the row came from v_untouched_generated_visits. */
  untouched:      boolean;
}

export interface ReconcilePlan {
  /** Occurrence dates that have no visit yet → insert. */
  toInsert:    string[];
  /** Untouched future visits whose date is no longer a valid occurrence → delete. */
  toDelete:    string[];   // visit ids
  /** Untouched future visits on a valid date but with the wrong template → update. */
  toRetemplate: string[];  // visit ids
  /** Rows that no longer match the rule but are operational → left alone. */
  protectedStale: string[];  // visit ids
  /** Rows already correct — no action. */
  unchanged:   number;
}

export interface ReconcileInput {
  /** Dates the current rule produces inside the window (from recurrence.ts). */
  desiredDates: string[];
  /** Generated visits that already exist for this schedule inside the window. */
  existing:     ExistingGeneratedVisit[];
  /** The schedule's current template. */
  templateId:   string | null;
  /**
   * Strictly-future cut-off (Riyadh today). Visits on or before this date are
   * never deleted or re-templated, even when untouched: today's visit may
   * already be in a merchandiser's hands.
   */
  today:        string;
}

/**
 * Build the reconciliation plan.
 *
 * Guarantees (asserted by scripts/test-reconcile.ts):
 *  • never proposes an id whose `untouched` flag is false
 *  • never proposes an id with scheduled_date <= today
 *  • toInsert, toDelete and toRetemplate are mutually disjoint
 *  • identical inputs always produce an identical plan
 *  • an unchanged schedule produces an entirely empty plan (idempotency)
 */
export function planReconciliation(input: ReconcileInput): ReconcilePlan {
  const { desiredDates, existing, templateId, today } = input;

  const desired = new Set(desiredDates);
  const seen    = new Set<string>();

  const plan: ReconcilePlan = {
    toInsert:       [],
    toDelete:       [],
    toRetemplate:   [],
    protectedStale: [],
    unchanged:      0,
  };

  for (const v of existing) {
    const isFuture = v.scheduled_date > today;

    if (desired.has(v.scheduled_date)) {
      seen.add(v.scheduled_date);

      // Date still valid. Only the template may need correcting, and only on
      // an untouched future row.
      if (v.template_id !== templateId) {
        if (v.untouched && isFuture) plan.toRetemplate.push(v.id);
        else                         plan.protectedStale.push(v.id);
      } else {
        plan.unchanged++;
      }
      continue;
    }

    // Date is no longer produced by the rule → stale.
    if (v.untouched && isFuture) plan.toDelete.push(v.id);
    else                         plan.protectedStale.push(v.id);
  }

  // Occurrences with no visit at all.
  for (const d of desiredDates) {
    if (!seen.has(d)) plan.toInsert.push(d);
  }

  plan.toInsert.sort();
  return plan;
}

/** True when the plan would change nothing (used to skip no-op writes). */
export function isNoopPlan(plan: ReconcilePlan): boolean {
  return (
    plan.toInsert.length === 0 &&
    plan.toDelete.length === 0 &&
    plan.toRetemplate.length === 0
  );
}
