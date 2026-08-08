import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  occurrencesFor,
  generationWindow,
  riyadhToday,
  type DayOfWeek,
  type Frequency,
} from "@/lib/recurrence";
import {
  planReconciliation,
  type ExistingGeneratedVisit,
} from "@/lib/schedule-reconcile";
import { authorizeScheduleReconcile } from "@/lib/reconcile-auth";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/schedules/[id]/reconcile
//
// Immediately reconciles ONE recurring schedule after an owner/admin edits it,
// so the manager sees the corrected visits at once instead of waiting for the
// daily generator.
//
// ── Security model ──────────────────────────────────────────────────────────
// This route uses the CALLER'S OWN Supabase session (cookie + anon key) for
// every read and write. It never touches SUPABASE_SERVICE_ROLE_KEY and never
// sees CRON_SECRET, so:
//   • the schedule lookup is RLS-scoped → another company's id is invisible
//   • v_untouched_generated_visits is RLS-scoped (migration 021 sets
//     security_invoker=true) → the delete gate cannot leak or target foreign rows
//   • every insert/update/delete is re-checked by visits_* policies, which
//     already restrict writes to owner|admin of the same company
// authorizeScheduleReconcile() adds an explicit pre-check on top so refusals
// return a clear status instead of an empty result.
//
// ── Idempotency ─────────────────────────────────────────────────────────────
// Safe to call any number of times. It re-derives the plan from current state
// each call; a second call on unchanged data is a no-op. Partial failures are
// therefore retryable with no compensating action.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Summary {
  scheduleId:          string;
  window:              { from: string; to: string };
  deletedFuturePending: number;
  retemplated:         number;
  inserted:            number;
  protected:           number;
  failures:            number;
}

function isFrequency(v: string): v is Frequency {
  return v === "weekly" || v === "biweekly" || v === "monthly";
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: scheduleId } = await context.params;

  if (!/^[0-9a-f-]{36}$/i.test(scheduleId)) {
    return NextResponse.json({ error: "invalid_schedule_id" }, { status: 400 });
  }

  try {
    const supabase = await createClient();

    // ── 1. Session ────────────────────────────────────────────────────────
    const { data: { user } } = await supabase.auth.getUser();

    // ── 2. Schedule, through the caller's RLS. A foreign company's schedule
    //       simply does not exist from here. ─────────────────────────────────
    const { data: schedule } = user
      ? await supabase
          .from("schedules")
          .select("id, company_id, merch_id, place_id, day_of_week, frequency, anchor_date, template_id, is_active")
          .eq("id", scheduleId)
          .maybeSingle()
      : { data: null };

    // ── 3. Membership in THAT company (not merely any company). ───────────
    const { data: membership } = user && schedule
      ? await supabase
          .from("company_users")
          .select("company_id, role, status")
          .eq("user_id", user.id)
          .eq("company_id", schedule.company_id)
          .eq("status", "active")
          .maybeSingle()
      : { data: null };

    // ── 4. Decide. ────────────────────────────────────────────────────────
    const auth = authorizeScheduleReconcile({
      userId:     user?.id ?? null,
      schedule:   schedule ? { id: schedule.id, company_id: schedule.company_id } : null,
      membership: membership ?? null,
    });

    if (!auth.ok) {
      return NextResponse.json({ error: auth.reason }, { status: auth.status });
    }

    const { from, to } = generationWindow();
    const today        = riyadhToday();

    const summary: Summary = {
      scheduleId,
      window:               { from, to },
      deletedFuturePending: 0,
      retemplated:          0,
      inserted:             0,
      protected:            0,
      failures:             0,
    };

    // An inactive schedule stops producing NEW visits. Reconciling it would
    // delete its future untouched visits, which is a different (destructive)
    // product decision — so this endpoint leaves inactive rules alone.
    if (!schedule!.is_active) {
      return NextResponse.json(summary);
    }

    // ── 5. Desired occurrences (shared recurrence module). ────────────────
    const dow = Number(schedule!.day_of_week);
    if (
      !schedule!.anchor_date ||
      !isFrequency(schedule!.frequency) ||
      !Number.isInteger(dow) || dow < 0 || dow > 6
    ) {
      // Malformed rule: report rather than guessing and writing bad data.
      summary.failures = 1;
      return NextResponse.json(summary, { status: 422 });
    }

    const desiredDates = occurrencesFor(
      {
        anchorDate: schedule!.anchor_date,
        dayOfWeek:  dow as DayOfWeek,
        frequency:  schedule!.frequency,
      },
      from,
      to
    );

    // ── 6. Current state + the untouched gate, both RLS-scoped. ───────────
    const [{ data: existingRows, error: existingErr },
           { data: untouchedRows, error: untouchedErr }] = await Promise.all([
      supabase
        .from("visits")
        .select("id, scheduled_date, template_id")
        .eq("schedule_id", scheduleId)
        .gte("scheduled_date", from)
        .lte("scheduled_date", to),
      supabase
        .from("v_untouched_generated_visits")
        .select("id")
        .eq("schedule_id", scheduleId)
        .gte("scheduled_date", from)
        .lte("scheduled_date", to),
    ]);

    if (existingErr)  throw existingErr;
    if (untouchedErr) throw untouchedErr;

    const untouchedIds = new Set((untouchedRows ?? []).map((r) => r.id as string));

    const existing: ExistingGeneratedVisit[] = (existingRows ?? []).map((r) => ({
      id:             r.id as string,
      scheduled_date: r.scheduled_date as string,
      template_id:    (r.template_id as string | null) ?? null,
      untouched:      untouchedIds.has(r.id as string),
    }));

    // ── 7. Plan (shared reconciliation module — no duplicate logic). ──────
    const plan = planReconciliation({
      desiredDates,
      existing,
      templateId: (schedule!.template_id as string | null) ?? null,
      today,
    });

    summary.protected = plan.protectedStale.length;

    // ── 8. Apply. Each phase is independent: a failure in one is counted and
    //       reported, and the remaining phases still run. Everything is
    //       re-derivable, so a retry converges. ──────────────────────────────
    if (plan.toDelete.length > 0) {
      const { data, error } = await supabase
        .from("visits")
        .delete()
        .in("id", plan.toDelete)
        .select("id");
      if (error) summary.failures++;
      else       summary.deletedFuturePending = data?.length ?? 0;
    }

    if (plan.toRetemplate.length > 0) {
      const { data, error } = await supabase
        .from("visits")
        .update({ template_id: (schedule!.template_id as string | null) ?? null })
        .in("id", plan.toRetemplate)
        .select("id");
      if (error) summary.failures++;
      else       summary.retemplated = data?.length ?? 0;
    }

    if (plan.toInsert.length > 0) {
      const rows = plan.toInsert.map((d) => ({
        company_id:       schedule!.company_id,
        place_id:         schedule!.place_id,
        merch_id:         schedule!.merch_id,
        schedule_id:      scheduleId,
        template_id:      (schedule!.template_id as string | null) ?? null,
        scheduled_date:   d,
        status:           "pending" as const,
        duration_minutes: 0,
      }));

      // Same conflict target as the generator: the partial unique index is
      // what actually prevents duplicates under concurrent runs.
      const { data, error } = await supabase
        .from("visits")
        .upsert(rows, { onConflict: "schedule_id,scheduled_date", ignoreDuplicates: true })
        .select("id");
      if (error) summary.failures++;
      else       summary.inserted = data?.length ?? 0;
    }

    console.info(
      `[reconcile] schedule=${scheduleId} deleted=${summary.deletedFuturePending} ` +
      `retemplated=${summary.retemplated} inserted=${summary.inserted} ` +
      `protected=${summary.protected} failures=${summary.failures}`
    );

    return NextResponse.json(summary, {
      status: summary.failures > 0 ? 207 : 200,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown";
    console.error(`[reconcile] schedule=${scheduleId} aborted: ${reason}`);
    // The schedule edit itself already committed and is NOT rolled back —
    // reconciliation is retryable and idempotent, so the caller can simply
    // call again (or wait for the daily generator to converge).
    return NextResponse.json({ error: "reconcile_failed" }, { status: 500 });
  }
}
