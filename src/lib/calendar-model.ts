// ─────────────────────────────────────────────────────────────────────────────
// Calendar presentation model — pure, deterministic, unit-tested.
//
// Adapts the EXISTING domain rows (visits + schedules) into what the calendar
// needs to draw. Nothing here changes the database model: `visits` has no
// planned-time column, so the planned time is resolved by joining back to the
// source schedule through `schedule_id`.
//
// ── Time resolution (never fabricated) ──────────────────────────────────────
//   1. started_at            → the visit actually began; most accurate
//   2. schedules.start_time  → the plan said this time (generated visits only)
//   3. none                  → the visit goes in the "Unscheduled" lane
// A manual visit carries no time at all and therefore always lands in the
// unscheduled lane. We never assume midnight/noon.
//
// ── Planned vs unplanned ────────────────────────────────────────────────────
// `schedule_id === null` means "not produced by a recurring rule". Today that
// is always a manager-created visit (RLS blocks merchandiser inserts, and
// `visits` has no created_by), so the UI labels it "Unplanned / غير مجدولة"
// meaning *outside the recurring plan* — which is exactly what the data says.
// ─────────────────────────────────────────────────────────────────────────────

import type { VisitStatus } from "@/types";

export type VisitOrigin = "planned" | "unplanned";
/** Where the block's time came from — drives the "planned vs actual" hint. */
export type TimeSource = "actual" | "planned" | "none";

export interface CalendarVisitItem {
  id:            string;
  merchId:       string;
  merchName:     string;
  merchColor:    string | null;
  placeName:     string;
  chainName:     string | null;
  chainColor:    string | null;
  scheduledDate: string;              // YYYY-MM-DD
  /** "HH:mm" or null when the visit has no time at all. */
  time:          string | null;
  /** Minutes from midnight; null mirrors `time === null`. */
  minutes:       number | null;
  timeSource:    TimeSource;
  status:        VisitStatus;
  scheduleId:    string | null;
  origin:        VisitOrigin;
}

// ─── Input shapes (structural — accepts the existing service rows) ───────────

export interface VisitLike {
  id:               string;
  merch_id:         string;
  scheduled_date:   string;
  status:           VisitStatus;
  started_at?:      string | null;
  schedule_id?:     string | null;
  place?: {
    branch_ar?: string;
    branch_en?: string;
    chain?: { name_ar?: string; name_en?: string; color?: string | null } | null;
  } | null;
  merch?: {
    color?: string | null;
    user?:  { full_name?: string } | null;
  } | null;
}

export interface ScheduleTimeLike {
  id:         string;
  start_time: string | null;   // "HH:mm" / "HH:mm:ss"
}

// ─── Time helpers ─────────────────────────────────────────────────────────────

/** "HH:mm[:ss]" → minutes from midnight, or null when unparseable. */
export function parseClock(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export function formatClock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Local wall-clock time of an ISO instant, in Asia/Riyadh (UTC+3, no DST) —
 * the business timezone used everywhere else in this codebase.
 */
export function riyadhClock(iso: string): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const shifted = new Date(t + 3 * 60 * 60_000);
  return `${String(shifted.getUTCHours()).padStart(2, "0")}:${String(shifted.getUTCMinutes()).padStart(2, "0")}`;
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

/**
 * Build one calendar item. `scheduleTimes` maps schedule_id → start_time so a
 * generated visit can show its planned time without an extra query per row.
 */
export function toCalendarItem(
  visit: VisitLike,
  scheduleTimes: Map<string, string | null>,
  locale: string,
  fallbackMerchName: string
): CalendarVisitItem {
  const scheduleId = visit.schedule_id ?? null;

  // 1. actual → 2. planned → 3. none. Never invented.
  let time: string | null = null;
  let timeSource: TimeSource = "none";

  if (visit.started_at) {
    const actual = riyadhClock(visit.started_at);
    if (actual) { time = actual; timeSource = "actual"; }
  }
  if (!time && scheduleId) {
    const planned = scheduleTimes.get(scheduleId);
    const parsed  = parseClock(planned);
    if (parsed !== null) { time = formatClock(parsed); timeSource = "planned"; }
  }

  const place = visit.place ?? null;
  const chain = place?.chain ?? null;

  return {
    id:            visit.id,
    merchId:       visit.merch_id,
    merchName:     visit.merch?.user?.full_name?.trim() || fallbackMerchName,
    merchColor:    visit.merch?.color ?? null,
    placeName:     (locale === "ar" ? place?.branch_ar : place?.branch_en) || "—",
    chainName:     (locale === "ar" ? chain?.name_ar : chain?.name_en) || null,
    chainColor:    chain?.color ?? null,
    scheduledDate: visit.scheduled_date,
    time,
    minutes:       time ? parseClock(time) : null,
    timeSource,
    status:        visit.status,
    scheduleId,
    origin:        scheduleId ? "planned" : "unplanned",
  };
}

export function buildScheduleTimeMap(
  schedules: ScheduleTimeLike[]
): Map<string, string | null> {
  return new Map(schedules.map((s) => [s.id, s.start_time]));
}

// ─── Grouping ─────────────────────────────────────────────────────────────────

export interface MerchLane {
  merchId:    string;
  merchName:  string;
  merchColor: string | null;
  /** Items with a resolved time, ascending. */
  timed:      CalendarVisitItem[];
  /** Items with no time at all — rendered in the Unscheduled lane. */
  untimed:    CalendarVisitItem[];
  total:      number;
  completed:  number;
}

/**
 * Group items into one lane per merchandiser, sorted by name. Merchandisers
 * with no visits in range are included when supplied via `allMerchs`, so the
 * grid still shows an empty row for them (a supervisor needs to see who is
 * idle, not just who is busy).
 */
export function groupByMerch(
  items: CalendarVisitItem[],
  allMerchs: Array<{ id: string; name: string; color: string | null }> = []
): MerchLane[] {
  const lanes = new Map<string, MerchLane>();

  const ensure = (id: string, name: string, color: string | null): MerchLane => {
    let lane = lanes.get(id);
    if (!lane) {
      lane = { merchId: id, merchName: name, merchColor: color, timed: [], untimed: [], total: 0, completed: 0 };
      lanes.set(id, lane);
    }
    return lane;
  };

  for (const m of allMerchs) ensure(m.id, m.name, m.color);

  for (const item of items) {
    const lane = ensure(item.merchId, item.merchName, item.merchColor);
    if (item.minutes === null) lane.untimed.push(item);
    else                       lane.timed.push(item);
    lane.total++;
    if (item.status === "completed") lane.completed++;
  }

  for (const lane of lanes.values()) {
    lane.timed.sort((a, b) => (a.minutes ?? 0) - (b.minutes ?? 0));
    lane.untimed.sort((a, b) => a.placeName.localeCompare(b.placeName));
  }

  return [...lanes.values()].sort((a, b) => a.merchName.localeCompare(b.merchName));
}

// ─── Day-view time axis ───────────────────────────────────────────────────────

export interface DayAxis {
  startHour: number;
  endHour:   number;
  hours:     number[];
}

/**
 * The hour range the day grid should span. Defaults to 08:00–18:00 and widens
 * only far enough to contain every timed visit, so an 06:00 start or a 21:00
 * finish is never clipped off the grid.
 */
export function computeDayAxis(
  items: CalendarVisitItem[],
  defaultStart = 8,
  defaultEnd = 18
): DayAxis {
  let start = defaultStart;
  let end   = defaultEnd;

  for (const i of items) {
    if (i.minutes === null) continue;
    const h = Math.floor(i.minutes / 60);
    if (h < start) start = h;
    if (h + 1 > end) end = h + 1;
  }

  start = Math.max(0, start);
  end   = Math.min(24, Math.max(end, start + 1));

  const hours: number[] = [];
  for (let h = start; h <= end; h++) hours.push(h);
  return { startHour: start, endHour: end, hours };
}

/** Horizontal position of a timed item as a 0–100 percentage of the axis. */
export function positionPercent(minutes: number, axis: DayAxis): number {
  const span = (axis.endHour - axis.startHour) * 60;
  if (span <= 0) return 0;
  const offset = minutes - axis.startHour * 60;
  return Math.min(100, Math.max(0, (offset / span) * 100));
}

// ─── Sub-lane packing ─────────────────────────────────────────────────────────

/**
 * Greedily pack timed items into sub-rows so two blocks never overlap.
 *
 * `slotMinutes` is how much horizontal room one block occupies expressed in
 * minutes of the axis — the calendar has no durations (a pending visit only
 * has a start time), so a block claims a fixed visual slot rather than a real
 * end time. Items are placed in the first row whose last block has cleared.
 */
export function packIntoRows(
  items: CalendarVisitItem[],
  slotMinutes: number
): CalendarVisitItem[][] {
  const rows: CalendarVisitItem[][] = [];
  const rowEnd: number[] = [];

  for (const item of [...items].sort((a, b) => (a.minutes ?? 0) - (b.minutes ?? 0))) {
    if (item.minutes === null) continue;
    let placed = false;
    for (let r = 0; r < rows.length; r++) {
      if (item.minutes >= rowEnd[r]) {
        rows[r].push(item);
        rowEnd[r] = item.minutes + slotMinutes;
        placed = true;
        break;
      }
    }
    if (!placed) {
      rows.push([item]);
      rowEnd.push(item.minutes + slotMinutes);
    }
  }

  return rows;
}

// ─── Week / month aggregation ─────────────────────────────────────────────────

export interface DayBucket {
  date:      string;
  items:     CalendarVisitItem[];
  total:     number;
  completed: number;
  missed:    number;
  inprogress: number;
  pending:   number;
}

export function bucketByDate(items: CalendarVisitItem[], dates: string[]): DayBucket[] {
  const buckets = new Map<string, DayBucket>(
    dates.map((d) => [d, { date: d, items: [], total: 0, completed: 0, missed: 0, inprogress: 0, pending: 0 }])
  );

  for (const item of items) {
    const b = buckets.get(item.scheduledDate);
    if (!b) continue;
    b.items.push(item);
    b.total++;
    if (item.status === "completed")  b.completed++;
    if (item.status === "missed")     b.missed++;
    if (item.status === "inprogress") b.inprogress++;
    if (item.status === "pending")    b.pending++;
  }

  for (const b of buckets.values()) {
    b.items.sort((a, z) => (a.minutes ?? 1e9) - (z.minutes ?? 1e9));
  }

  return dates.map((d) => buckets.get(d)!);
}
