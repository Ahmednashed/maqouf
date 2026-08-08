import { NextResponse, type NextRequest } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  occurrencesFor,
  generationWindow,
  riyadhToday,
  type DayOfWeek,
  type Frequency,
} from "@/lib/recurrence";
import {
  planReconciliation,
  isNoopPlan,
  type ExistingGeneratedVisit,
} from "@/lib/schedule-reconcile";

// ─────────────────────────────────────────────────────────────────────────────
// Recurring-schedule → visit generator + reconciler.
//
// Runs server-side only. Safe to run any number of times: the partial unique
// index uq_visits_schedule_occurrence (019) makes inserts idempotent, and the
// reconciler only ever touches ids returned by v_untouched_generated_visits
// (020) that are also strictly in the future.
//
// Query parameters
//   ?dryRun=true          plan only — reports exactly what WOULD change and
//                         writes nothing at all
//   ?scheduleId=<uuid>    reconcile a single schedule immediately (used right
//                         after an edit instead of waiting for the daily run)
//
// Auth: CRON_SECRET via `Authorization: Bearer`. Fails closed. No
// unauthenticated path exists.
// RLS: writes use the service-role key (server-only). No policy changed.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime     = "nodejs";
export const dynamic     = "force-dynamic";
export const maxDuration = 60;

const INSERT_CHUNK = 500;

interface ScheduleRow {
  id:          string;
  company_id:  string;
  merch_id:    string;
  place_id:    string;
  day_of_week: string;
  frequency:   string;
  anchor_date: string | null;
  template_id: string | null;
  is_active:   boolean;
}

interface Summary {
  dryRun:               boolean;
  scopedToSchedule:     string | null;
  window:               { from: string; to: string };
  schedulesProcessed:   number;
  occurrencesEvaluated: number;
  visitsInserted:       number;
  duplicatesSkipped:    number;
  /** Stale untouched future visits removed after a schedule edit. */
  staleVisitsDeleted:   number;
  /** Untouched future visits whose template was corrected. */
  visitsRetemplated:    number;
  /** Stale/mismatched rows left alone because they are operational. */
  protectedVisits:      number;
  /** Active schedules with no template — generated visits carry no checklist. */
  schedulesWithoutTemplate: number;
  failures:             number;
  failed:               Array<{ scheduleId: string; reason: string }>;
  durationMs:           number;
}

function isFrequency(v: string): v is Frequency {
  return v === "weekly" || v === "biweekly" || v === "monthly";
}

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;                       // fail closed
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

function adminClient(): SupabaseClient {
  const url        = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("supabase_not_configured");
  return createAdmin(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function runGeneration(opts: {
  dryRun:     boolean;
  scheduleId: string | null;
}): Promise<Summary> {
  const startedAt    = Date.now();
  const { from, to } = generationWindow();
  const today        = riyadhToday();

  const summary: Summary = {
    dryRun:               opts.dryRun,
    scopedToSchedule:     opts.scheduleId,
    window:               { from, to },
    schedulesProcessed:   0,
    occurrencesEvaluated: 0,
    visitsInserted:       0,
    duplicatesSkipped:    0,
    staleVisitsDeleted:   0,
    visitsRetemplated:    0,
    protectedVisits:      0,
    schedulesWithoutTemplate: 0,
    failures:             0,
    failed:               [],
    durationMs:           0,
  };

  const admin = adminClient();

  // ── 1. Active schedules (optionally one). Inactive rules stop producing
  //       NEW visits; what they already produced is never touched. ──────────
  let schedQuery = admin
    .from("schedules")
    .select("id, company_id, merch_id, place_id, day_of_week, frequency, anchor_date, template_id, is_active")
    .eq("is_active", true);

  if (opts.scheduleId) schedQuery = schedQuery.eq("id", opts.scheduleId);

  const { data: schedules, error: schedErr } = await schedQuery;
  if (schedErr) throw schedErr;

  const rules = (schedules ?? []) as ScheduleRow[];
  if (rules.length === 0) {
    summary.durationMs = Date.now() - startedAt;
    return summary;
  }

  const scheduleIds = rules.map((s) => s.id);

  // ── 2. Existing generated visits in the window (one query), plus the set
  //       of ids the database certifies as untouched. ───────────────────────
  let existingQuery = admin
    .from("visits")
    .select("id, schedule_id, scheduled_date, template_id")
    .in("schedule_id", scheduleIds)
    .gte("scheduled_date", from)
    .lte("scheduled_date", to);

  const { data: existingRows, error: existingErr } = await existingQuery;
  if (existingErr) throw existingErr;

  // The delete/re-template gate: only ids present here may ever be touched.
  const { data: untouchedRows, error: untouchedErr } = await admin
    .from("v_untouched_generated_visits")
    .select("id")
    .in("schedule_id", scheduleIds)
    .gte("scheduled_date", from)
    .lte("scheduled_date", to);
  if (untouchedErr) throw untouchedErr;

  const untouchedIds = new Set((untouchedRows ?? []).map((r) => r.id as string));

  const bySchedule = new Map<string, ExistingGeneratedVisit[]>();
  for (const r of existingRows ?? []) {
    const sid = r.schedule_id as string;
    const list = bySchedule.get(sid) ?? [];
    list.push({
      id:             r.id as string,
      scheduled_date: r.scheduled_date as string,
      template_id:    (r.template_id as string | null) ?? null,
      untouched:      untouchedIds.has(r.id as string),
    });
    bySchedule.set(sid, list);
  }

  // ── 3. Plan per schedule. One malformed rule must not abort the run. ─────
  type PendingVisit = {
    company_id: string;
    place_id: string;
    merch_id: string;
    schedule_id: string;
    template_id: string | null;
    scheduled_date: string;
    status: "pending";
    duration_minutes: number;
  };

  const pending:      PendingVisit[] = [];
  const deleteIds:    string[]       = [];
  const retemplate:   Array<{ id: string; template_id: string | null }> = [];

  for (const s of rules) {
    try {
      if (!s.anchor_date) {
        summary.failures++;
        summary.failed.push({ scheduleId: s.id, reason: "missing_anchor_date" });
        continue;
      }
      if (!isFrequency(s.frequency)) {
        summary.failures++;
        summary.failed.push({ scheduleId: s.id, reason: "unsupported_frequency" });
        continue;
      }
      const dow = Number(s.day_of_week);
      if (!Number.isInteger(dow) || dow < 0 || dow > 6) {
        summary.failures++;
        summary.failed.push({ scheduleId: s.id, reason: "invalid_day_of_week" });
        continue;
      }

      // Template-less schedules still generate — the product supports visits
      // without a checklist — but they are counted so the gap is visible in
      // every run summary rather than silently accumulating.
      if (!s.template_id) summary.schedulesWithoutTemplate++;

      const desiredDates = occurrencesFor(
        { anchorDate: s.anchor_date, dayOfWeek: dow as DayOfWeek, frequency: s.frequency },
        from,
        to
      );

      const plan = planReconciliation({
        desiredDates,
        existing:   bySchedule.get(s.id) ?? [],
        templateId: s.template_id,
        today,
      });

      summary.schedulesProcessed++;
      summary.occurrencesEvaluated += desiredDates.length;
      summary.duplicatesSkipped    += plan.unchanged;
      summary.protectedVisits      += plan.protectedStale.length;

      for (const d of plan.toInsert) {
        pending.push({
          company_id:       s.company_id,
          place_id:         s.place_id,
          merch_id:         s.merch_id,
          schedule_id:      s.id,
          template_id:      s.template_id,     // inherited from the schedule
          scheduled_date:   d,
          status:           "pending",
          duration_minutes: 0,
        });
      }

      if (!isNoopPlan(plan)) {
        deleteIds.push(...plan.toDelete);
        for (const id of plan.toRetemplate) {
          retemplate.push({ id, template_id: s.template_id });
        }
      }
    } catch (err) {
      summary.failures++;
      summary.failed.push({
        scheduleId: s.id,
        reason: err instanceof Error ? err.message.slice(0, 80) : "unknown",
      });
    }
  }

  // ── 4. Dry run stops here — report the plan, write nothing. ──────────────
  if (opts.dryRun) {
    summary.visitsInserted     = pending.length;
    summary.staleVisitsDeleted = deleteIds.length;
    summary.visitsRetemplated  = retemplate.length;
    summary.durationMs         = Date.now() - startedAt;
    return summary;
  }

  // ── 5. Delete stale untouched future visits. Every id was certified by
  //       v_untouched_generated_visits AND by the future-date cut; the
  //       `.in("id", …)` re-scopes the delete to exactly those rows. ────────
  for (let i = 0; i < deleteIds.length; i += INSERT_CHUNK) {
    const chunk = deleteIds.slice(i, i + INSERT_CHUNK);
    const { data, error } = await admin
      .from("visits")
      .delete()
      .in("id", chunk)
      .select("id");

    if (error) {
      summary.failures++;
      summary.failed.push({ scheduleId: "(delete)", reason: error.code ?? "delete_failed" });
      continue;
    }
    summary.staleVisitsDeleted += data?.length ?? 0;
  }

  // ── 6. Correct the template on untouched future visits. ──────────────────
  for (const r of retemplate) {
    const { error } = await admin
      .from("visits")
      .update({ template_id: r.template_id })
      .eq("id", r.id);

    if (error) {
      summary.failures++;
      summary.failed.push({ scheduleId: "(retemplate)", reason: error.code ?? "update_failed" });
      continue;
    }
    summary.visitsRetemplated++;
  }

  // ── 7. Insert missing occurrences. ON CONFLICT DO NOTHING against the
  //       unique index is the real idempotency guarantee. ──────────────────
  for (let i = 0; i < pending.length; i += INSERT_CHUNK) {
    const chunk = pending.slice(i, i + INSERT_CHUNK);
    const { data, error } = await admin
      .from("visits")
      .upsert(chunk, { onConflict: "schedule_id,scheduled_date", ignoreDuplicates: true })
      .select("id");

    if (error) {
      summary.failures++;
      summary.failed.push({ scheduleId: "(batch)", reason: error.code ?? "insert_failed" });
      continue;
    }
    const inserted = data?.length ?? 0;
    summary.visitsInserted    += inserted;
    summary.duplicatesSkipped += chunk.length - inserted;
  }

  summary.durationMs = Date.now() - startedAt;
  return summary;
}

// ── Handler ───────────────────────────────────────────────────────────────────

async function handle(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const params     = request.nextUrl.searchParams;
  const dryRun     = params.get("dryRun") === "true";
  const scheduleId = params.get("scheduleId");

  // Reject a malformed id rather than silently widening to a full run.
  if (scheduleId && !/^[0-9a-f-]{36}$/i.test(scheduleId)) {
    return NextResponse.json({ error: "invalid_schedule_id" }, { status: 400 });
  }

  try {
    const summary = await runGeneration({ dryRun, scheduleId });
    console.info(
      `[generate-visits]${summary.dryRun ? " DRY-RUN" : ""} ` +
      `${summary.window.from}→${summary.window.to} ` +
      `schedules=${summary.schedulesProcessed} evaluated=${summary.occurrencesEvaluated} ` +
      `inserted=${summary.visitsInserted} skipped=${summary.duplicatesSkipped} ` +
      `deleted=${summary.staleVisitsDeleted} retemplated=${summary.visitsRetemplated} ` +
      `protected=${summary.protectedVisits} noTemplate=${summary.schedulesWithoutTemplate} ` +
      `failures=${summary.failures} ms=${summary.durationMs}`
    );
    return NextResponse.json(summary);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown";
    console.error(`[generate-visits] aborted: ${reason}`);
    return NextResponse.json({ error: "generation_failed" }, { status: 500 });
  }
}

export async function GET(request: NextRequest)  { return handle(request); }
export async function POST(request: NextRequest) { return handle(request); }
