// ─────────────────────────────────────────────────────────────────────────────
// Authorization decision for per-schedule reconciliation.
//
// Pure and dependency-free so every branch is unit-testable without a
// database. The route performs the I/O (session lookup, membership lookup,
// schedule lookup) and hands the results here; this module decides only
// whether the operation may proceed.
//
// This is defence in depth, NOT the security boundary. The real boundary is
// RLS: the endpoint performs all reads and writes with the caller's own
// Supabase session, so `visits_insert` / `visits_update` / `visits_delete`
// (owner|admin, same company) and `schedules_select` are enforced by the
// database regardless of what this function returns. The explicit check exists
// so an unauthorized caller gets a clear 401/403/404 instead of a confusing
// partial success or an empty result.
// ─────────────────────────────────────────────────────────────────────────────

export type ReconcileDenyReason =
  | "unauthenticated"
  | "schedule_not_found"
  | "no_membership"
  | "insufficient_role";

export interface ReconcileAuthInput {
  /** auth.users id, or null when there is no valid session. */
  userId: string | null;
  /**
   * The schedule, as read back through the CALLER's RLS-scoped client.
   * null means "not visible to this user" — which covers both a genuinely
   * missing row and another company's row. They are deliberately
   * indistinguishable to the caller (no tenant enumeration).
   */
  schedule: { id: string; company_id: string } | null;
  /**
   * The caller's ACTIVE membership in the schedule's company, or null.
   * Read with `.eq("company_id", schedule.company_id)` so a user who belongs
   * to a different company resolves to null here.
   */
  membership: { company_id: string; role: string; status: string } | null;
}

export interface ReconcileAuthResult {
  ok:      boolean;
  status:  number;
  reason?: ReconcileDenyReason;
}

const ALLOWED_ROLES = new Set(["owner", "admin"]);

const ALLOW: ReconcileAuthResult = { ok: true, status: 200 };

/**
 * Decide whether `userId` may reconcile `schedule`.
 *
 * Order matters: authentication → visibility → membership → role. Each step
 * returns the narrowest correct status without revealing whether a hidden
 * schedule exists.
 */
export function authorizeScheduleReconcile(
  input: ReconcileAuthInput
): ReconcileAuthResult {
  const { userId, schedule, membership } = input;

  // 1. No valid session.
  if (!userId) {
    return { ok: false, status: 401, reason: "unauthenticated" };
  }

  // 2. Schedule not visible under the caller's RLS. Cross-company access lands
  //    here and is reported as 404 — never 403 — so the response cannot be
  //    used to probe for the existence of another tenant's schedules.
  if (!schedule) {
    return { ok: false, status: 404, reason: "schedule_not_found" };
  }

  // 3. No active membership in that company (belt-and-braces: RLS should have
  //    already hidden the schedule in step 2).
  if (!membership || membership.status !== "active") {
    return { ok: false, status: 404, reason: "no_membership" };
  }

  // 4. Membership must be in the SCHEDULE's company, not merely any company.
  if (membership.company_id !== schedule.company_id) {
    return { ok: false, status: 404, reason: "no_membership" };
  }

  // 5. Reconciliation writes visits, which visits_insert/update/delete restrict
  //    to owner|admin. Merchandisers are refused explicitly rather than being
  //    allowed to attempt writes that RLS would silently reject.
  if (!ALLOWED_ROLES.has(membership.role)) {
    return { ok: false, status: 403, reason: "insufficient_role" };
  }

  return ALLOW;
}
