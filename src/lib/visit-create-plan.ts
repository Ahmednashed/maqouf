// ─────────────────────────────────────────────────────────────────────────────
// Add-Visit decision layer — pure, deterministic, unit-tested.
//
// THE CRITICAL RULE lives here and nowhere else: a submission produces
// EITHER a Visit OR a Schedule, never both. The return type is a discriminated
// union, so "create both" is not merely discouraged — it is unrepresentable.
//
// Why it matters: a manual visit (schedule_id NULL) and a generated visit for
// the same date do NOT collide under uq_visits_schedule_occurrence, because
// that index is partial (WHERE schedule_id IS NOT NULL). The database cannot
// catch this duplicate, so the guarantee has to be structural.
//
// Recurring never inserts a visit at all. The first occurrence is materialised
// by the existing generator via POST /api/schedules/[id]/reconcile — the same
// code path the daily job uses. No recurrence maths is duplicated here.
// ─────────────────────────────────────────────────────────────────────────────

import type { DayOfWeek, ScheduleFrequency } from "@/types";
import { dayOfWeek } from "./recurrence";

/** UI-level choice. "once" is the default and maps to a plain Visit. */
export type RecurrenceChoice = "once" | ScheduleFrequency;

export const RECURRENCE_CHOICES: RecurrenceChoice[] = [
  "once", "weekly", "biweekly", "monthly",
];

export function isRecurring(choice: RecurrenceChoice): choice is ScheduleFrequency {
  return choice !== "once";
}

// ─── Input ────────────────────────────────────────────────────────────────────

export interface VisitFormInput {
  place_id:       string;
  merch_id:       string;
  scheduled_date: string;               // YYYY-MM-DD — the first occurrence
  template_id?:   string | null;
  notes?:         string | null;
  recurrence:     RecurrenceChoice;
  /** "HH:mm". Required for recurring (schedules.start_time is NOT NULL). */
  start_time?:    string | null;
}

// ─── Output ───────────────────────────────────────────────────────────────────

export interface VisitPlan {
  kind: "visit";
  payload: {
    place_id:       string;
    merch_id:       string;
    scheduled_date: string;
    template_id?:   string;
    notes?:         string;
  };
}

export interface SchedulePlan {
  kind: "schedule";
  payload: {
    merch_id:    string;
    place_id:    string;
    day_of_week: DayOfWeek;
    start_time:  string;
    frequency:   ScheduleFrequency;
    is_active:   boolean;
    /** The chosen first date — the recurrence origin. */
    anchor_date: string;
    template_id: string | null;
  };
}

export type CreatePlan = VisitPlan | SchedulePlan;

export type PlanError =
  | "place_required"
  | "merch_required"
  | "date_required"
  | "date_invalid"
  | "time_required_for_recurring"
  | "time_invalid";

export type PlanResult =
  | { ok: true;  plan: CreatePlan }
  | { ok: false; error: PlanError };

// ─── Validation helpers ───────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function blank(v: string | null | undefined): boolean {
  return !v || v.trim() === "";
}

// ─── Planner ──────────────────────────────────────────────────────────────────

/**
 * Decide what a submission creates.
 *
 * Guarantees (asserted by scripts/test-visit-create.ts):
 *  • "once"      → kind "visit"    — a Schedule is never produced
 *  • recurring   → kind "schedule" — a Visit is never produced
 *  • anchor_date === the chosen first date, verbatim
 *  • day_of_week is derived from that date, never asked for separately
 *  • recurring without a valid start_time is refused before any write
 */
export function planVisitCreation(input: VisitFormInput): PlanResult {
  if (blank(input.place_id)) return { ok: false, error: "place_required" };
  if (blank(input.merch_id)) return { ok: false, error: "merch_required" };
  if (blank(input.scheduled_date)) return { ok: false, error: "date_required" };
  if (!DATE_RE.test(input.scheduled_date)) return { ok: false, error: "date_invalid" };

  const template = blank(input.template_id) ? null : input.template_id!.trim();
  const notes    = blank(input.notes)       ? null : input.notes!.trim();

  // ── ONE-TIME → a Visit, and only a Visit ────────────────────────────────
  if (!isRecurring(input.recurrence)) {
    return {
      ok: true,
      plan: {
        kind: "visit",
        payload: {
          place_id:       input.place_id,
          merch_id:       input.merch_id,
          scheduled_date: input.scheduled_date,
          // `visits` has no planned-time column, so a time is deliberately
          // NOT carried here — we don't pretend to persist what cannot be
          // stored. Adding one is a schema decision, not a form decision.
          ...(template ? { template_id: template } : {}),
          ...(notes    ? { notes }                 : {}),
        },
      },
    };
  }

  // ── RECURRING → a Schedule, and only a Schedule ─────────────────────────
  if (blank(input.start_time)) {
    return { ok: false, error: "time_required_for_recurring" };
  }
  const time = input.start_time!.trim().slice(0, 5);
  if (!TIME_RE.test(time)) {
    return { ok: false, error: "time_invalid" };
  }

  return {
    ok: true,
    plan: {
      kind: "schedule",
      payload: {
        merch_id:    input.merch_id,
        place_id:    input.place_id,
        // Derived from the chosen date — the user never picks a weekday twice.
        day_of_week: dayOfWeek(input.scheduled_date),
        start_time:  time,
        frequency:   input.recurrence,
        is_active:   true,
        // The chosen date IS the recurrence origin, so the first occurrence
        // the generator produces is exactly the date the user picked.
        anchor_date: input.scheduled_date,
        template_id: template,
      },
    },
  };
}

// ─── Error classification ─────────────────────────────────────────────────────

/**
 * Recognise the `UNIQUE (company_id, merch_id, place_id, day_of_week)`
 * violation from migration 002 so the UI can show a friendly message instead
 * of a raw Postgres error.
 */
export function isDuplicateScheduleError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string; details?: string };
  if (e.code === "23505") return true;
  const haystack = `${e.message ?? ""} ${e.details ?? ""}`.toLowerCase();
  return haystack.includes("uq_schedules_merch_place_day");
}
