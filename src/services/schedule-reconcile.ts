// ─────────────────────────────────────────────────────────────────────────────
// Client-side caller for POST /api/schedules/[id]/reconcile.
//
// The browser sends nothing but the schedule id and its own session cookie.
// It never holds CRON_SECRET or the service-role key — authorization is
// decided entirely server-side and re-enforced by RLS.
//
// Never throws: a failed reconciliation must not undo or obscure a schedule
// edit that already succeeded. The caller decides how to surface it.
// ─────────────────────────────────────────────────────────────────────────────

export interface ReconcileSummary {
  scheduleId:           string;
  window:               { from: string; to: string };
  deletedFuturePending: number;
  retemplated:          number;
  inserted:             number;
  protected:            number;
  failures:             number;
}

export interface ReconcileOutcome {
  ok:       boolean;
  /** True when at least one visit was inserted, deleted or re-templated. */
  changed:  boolean;
  summary?: ReconcileSummary;
  /** Server-side reason code when ok === false (never shown raw to users). */
  reason?:  string;
}

export async function reconcileSchedule(
  scheduleId: string
): Promise<ReconcileOutcome> {
  try {
    const res = await fetch(
      `/api/schedules/${encodeURIComponent(scheduleId)}/reconcile`,
      { method: "POST" }
    );

    // 200 = clean, 207 = applied with at least one phase failure.
    if (!res.ok && res.status !== 207) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, changed: false, reason: body?.error ?? `http_${res.status}` };
    }

    const summary = (await res.json()) as ReconcileSummary;
    const changed =
      summary.inserted > 0 ||
      summary.deletedFuturePending > 0 ||
      summary.retemplated > 0;

    return {
      ok: summary.failures === 0,
      changed,
      summary,
    };
  } catch {
    // Offline / network failure. The daily generator will converge later.
    return { ok: false, changed: false, reason: "network" };
  }
}
