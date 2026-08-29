// ─────────────────────────────────────────────────────────────────────────────
// One reading of what a visit's GPS check actually proves.
//
// WHY THIS EXISTS
// ───────────────
// `visits.checkin_verified` is `BOOLEAN NOT NULL DEFAULT FALSE` (migration
// 009), so every visit ever started carries a definite true/false — including
// visits where no GPS was captured at all, and visits to branches that have no
// coordinates on file. Reading that column alone, "false" looks like a failed
// geofence check.
//
// It almost never is. startVisit() THROWS when a check-in is outside the
// radius, so an out-of-radius attempt is rejected rather than recorded. In
// practice `false` means one thing: nothing was measured. The GPS report was
// nevertheless colouring that count red and dividing by it, which scores a
// merchandiser down for a branch whose coordinates were never entered — a
// setup gap they do not control.
//
// This distinguishes the cases from columns that already exist. No migration.
// ─────────────────────────────────────────────────────────────────────────────

export type GpsCheckState =
  /** A position was captured and validated against the branch. */
  | "verified"
  /** A position was captured but did not validate against the branch. */
  | "outside"
  /** No position was captured — nothing is known either way. */
  | "not_recorded";

// Every field is optional-and-nullable because the Visit type declares the
// migration-009 columns as optional. Absent and null mean the same thing here
// — nothing was measured — so both are accepted rather than forcing callers to
// normalise before asking a question about their own row.
export interface GpsCheckSource {
  checkin_verified?:        boolean | null;
  checkin_lat?:             number | null;
  checkin_lng?:             number | null;
  checkin_distance_meters?: number | null;
  checkin_accuracy?:        number | null;
}

/**
 * Classify one visit's check-in.
 *
 * A stored coordinate is the evidence that something was measured. Without
 * one, `checkin_verified === false` is the column's default rather than a
 * finding, so it must not be reported as a failure.
 *
 * "outside" is unreachable through startVisit() today and is expected to stay
 * empty. It exists so that the day the radius rule softens into a recorded
 * exception, a real failure has somewhere truthful to land instead of being
 * silently counted as missing data.
 */
export function gpsCheckState(v: GpsCheckSource): GpsCheckState {
  if (v.checkin_verified === true) return "verified";
  const hasFix = v.checkin_lat !== null && v.checkin_lat !== undefined
              && v.checkin_lng !== null && v.checkin_lng !== undefined;
  return hasFix ? "outside" : "not_recorded";
}

/** Whether a branch can support a GPS check at all. */
export function branchHasCoords(
  place: { lat?: number | null; lng?: number | null } | null | undefined,
): boolean {
  return (
    place?.lat !== null && place?.lat !== undefined &&
    place?.lng !== null && place?.lng !== undefined
  );
}

// ─── Report roll-up ───────────────────────────────────────────────────────────

export interface GpsTally {
  /** Visits started in the period. */
  started:      number;
  verified:     number;
  outside:      number;
  notRecorded:  number;
  /**
   * Started visits whose branch has no coordinates. These CANNOT produce a
   * verified check-in no matter what the merchandiser does, so they are the
   * actionable part of a low score — and the reason it is reported separately
   * rather than folded into a failure count.
   */
  noBranchCoords: number;
  /**
   * verified / (verified + outside), as a percentage — measured visits only.
   *
   * `null`, never 0, when nothing was measured. A rate of 0% asserts that
   * every checked visit failed; "no data" asserts nothing, which is the
   * truthful answer when the denominator is empty.
   */
  rate: number | null;
  /** Mean distance in metres across verified check-ins; null when none. */
  avgDistance: number | null;
}

export interface GpsTallyRow extends GpsCheckSource {
  place?: { lat?: number | null; lng?: number | null } | null;
}

export function tallyGps(rows: GpsTallyRow[]): GpsTally {
  const t: GpsTally = {
    started: 0, verified: 0, outside: 0, notRecorded: 0,
    noBranchCoords: 0, rate: null, avgDistance: null,
  };
  const distances: number[] = [];

  for (const r of rows) {
    t.started += 1;
    if (!branchHasCoords(r.place)) t.noBranchCoords += 1;

    switch (gpsCheckState(r)) {
      case "verified":
        t.verified += 1;
        if (r.checkin_distance_meters !== null && r.checkin_distance_meters !== undefined) {
          distances.push(r.checkin_distance_meters);
        }
        break;
      case "outside":      t.outside += 1;     break;
      case "not_recorded": t.notRecorded += 1; break;
    }
  }

  const measured = t.verified + t.outside;
  t.rate = measured > 0 ? Math.round((t.verified / measured) * 100) : null;
  t.avgDistance = distances.length > 0
    ? Math.round(distances.reduce((a, b) => a + b, 0) / distances.length)
    : null;

  return t;
}
