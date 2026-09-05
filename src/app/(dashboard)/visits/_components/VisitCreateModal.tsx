"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarDays, MapPin, User, FileText, Repeat, Clock, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Modal } from "@/components/ui/Modal";
import { riyadhToday } from "@/lib/utils/date";
import { useTranslation } from "@/hooks/use-translation";
import { useCreateVisit } from "@/hooks/use-visits";
import { usePlaces, usePlaceOperations } from "@/hooks/use-places";
import {
  branchContext,
  isMerchMismatch,
  previewOccurrences,
} from "@/lib/visit-context";
import { CheckCircle2, Package, MapPinOff, History, Info } from "lucide-react";
import { useCompanyUsers } from "@/hooks/use-company-users";
import { useTemplates } from "@/hooks/use-templates";
import { createSchedule } from "@/services/schedules";
import { SCHEDULES_QUERY_KEY } from "@/hooks/use-schedules";
import { reconcileSchedule } from "@/services/schedule-reconcile";
import {
  planVisitCreation,
  isDuplicateScheduleError,
  isRecurring,
  RECURRENCE_CHOICES,
  type RecurrenceChoice,
  type PlanError,
} from "@/lib/visit-create-plan";
import type { TranslationKey } from "@/lib/i18n/translations";
import { merchDisplayName } from "@/lib/utils/member-name";
import { fieldCountLabel, pluralKey } from "@/lib/i18n/plural";

// ─── Schema ───────────────────────────────────────────────────────────────────

const schema = z.object({
  place_id:       z.string().min(1, "Branch is required"),
  merch_id:       z.string().min(1, "Merchandiser is required"),
  scheduled_date: z.string().min(1, "Date is required"),
  template_id:    z.string().optional(),
  notes:          z.string().optional(),
  // "once" (default) creates a Visit; anything else creates a Schedule.
  recurrence:     z.enum(["once", "weekly", "biweekly", "monthly"]),
  // Required only for recurring — schedules.start_time is NOT NULL.
  start_time:     z.string().optional(),
});

type FormData = z.infer<typeof schema>;

/** Planner error code → translated message. */
const PLAN_ERROR_KEY: Record<PlanError, TranslationKey> = {
  place_required:              "visits.recur.placeRequired",
  merch_required:              "visits.recur.merchRequired",
  date_required:               "visits.recur.dateRequired",
  date_invalid:                "visits.recur.dateRequired",
  time_required_for_recurring: "visits.recur.timeRequired",
  time_invalid:                "visits.recur.timeInvalid",
};

/** Recurrence choice → option label. */
const RECURRENCE_LABEL: Record<RecurrenceChoice, TranslationKey> = {
  once:     "visits.recur.once",
  weekly:   "visits.recur.weekly",
  biweekly: "visits.recur.biweekly",
  monthly:  "visits.recur.monthly",
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface VisitCreateModalProps {
  onClose: () => void;
  /**
   * Date the calendar is currently showing ("YYYY-MM-DD"). The new visit
   * defaults to the day the user is looking at; falls back to today.
   */
  initialDate?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function VisitCreateModal({ onClose, initialDate }: VisitCreateModalProps) {
  const { t, locale } = useTranslation();
  const qc       = useQueryClient();
  const create   = useCreateVisit();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError]   = useState<string | null>(null);
  const { data: places    = [] } = usePlaces();
  const { data: members   = [] } = useCompanyUsers();
  const { data: templates = [] } = useTemplates();
  // Same query key /places and the dashboard already use, so this is normally
  // served from cache rather than costing the modal a round-trip.
  const { data: placeOps, isSuccess: opsReady } = usePlaceOperations();

  const activePlaces     = places.filter((p) => p.is_active);
  const activeMembers    = members.filter((m) => m.status === "active");
  // Only a published template that actually has fields gives the merchandiser
  // something to fill in. Publishing an empty one is blocked at the source,
  // but rows that predate that guard are still in the database.
  const assignableTemplates = templates.filter(
    (t) => t.status === "active" && t.field_count > 0
  );
  // Drafts are NOT assignable (a visit must reference a published checklist),
  // but hiding them entirely made new templates look like they vanished.
  // They are listed as disabled options carrying the reason instead — and so
  // are published-but-empty ones, for the same reason.
  const emptyTemplates   = templates.filter(
    (t) => t.status === "active" && t.field_count === 0
  );
  const draftTemplates   = templates.filter((t) => t.status === "draft");

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      scheduled_date: initialDate ?? riyadhToday(),
      recurrence:     "once",
      start_time:     "",
    },
  });

  const recurrence = watch("recurrence");
  const recurring  = isRecurring(recurrence);
  const placeId    = watch("place_id");
  const merchId    = watch("merch_id");
  const chosenDate = watch("scheduled_date");
  const startTime  = watch("start_time");

  const today        = riyadhToday();
  const chosenPlace  = activePlaces.find((p) => p.id === placeId) ?? null;
  const ctx          = chosenPlace ? branchContext(chosenPlace, placeOps?.[chosenPlace.id], today) : null;
  const ownerName    = ctx?.assignedUserId
    ? merchDisplayName(activeMembers.find((m) => m.id === ctx.assignedUserId), t("users.unknown"))
    : null;
  const mismatch     = ctx ? isMerchMismatch(ctx.assignedUserId, merchId ?? "") : false;

  // Built from the same generator the daily job runs, anchored the same way
  // the planner anchors it, so the preview cannot promise a series the system
  // would not create.
  const preview = recurring && chosenDate
    ? previewOccurrences(chosenDate, recurrence as "weekly" | "biweekly" | "monthly", 3)
    : null;

  const dateFmt = (iso: string, opts: Intl.DateTimeFormatOptions) =>
    new Date(iso + "T12:00:00").toLocaleDateString(
      locale === "ar" ? "ar-SA-u-ca-gregory" : "en-GB", opts,
    );
  const sub = (key: string, vals: Record<string, string | number>) =>
    Object.entries(vals).reduce((acc, [k, v]) => acc.replace(`{${k}}`, String(v)), key);

  async function onSubmit(data: FormData) {
    setFormError(null);

    // The planner returns EITHER a visit plan OR a schedule plan — the
    // "create both" case is unrepresentable, which is what prevents a manual
    // visit and a generated visit landing on the same date.
    const result = planVisitCreation({
      place_id:       data.place_id,
      merch_id:       data.merch_id,
      scheduled_date: data.scheduled_date,
      template_id:    data.template_id,
      notes:          data.notes,
      recurrence:     data.recurrence,
      start_time:     data.start_time,
    });

    if (!result.ok) {
      setFormError(t(PLAN_ERROR_KEY[result.error]));
      return;
    }

    setSubmitting(true);
    try {
      // ── ONE-TIME: a Visit, and nothing else ──────────────────────────────
      if (result.plan.kind === "visit") {
        try {
          await create.mutateAsync(result.plan.payload);
        } catch {
          // Keep the modal open with the entered data rather than closing
          // over a failed write. useCreateVisit already toasts the cause.
          setFormError(t("visits.errorCreate"));
          return;
        }
        onClose();
        return;
      }

      // ── RECURRING: a Schedule, and nothing else ─────────────────────────
      let scheduleId: string;
      try {
        const schedule = await createSchedule(result.plan.payload);
        scheduleId = schedule.id;
      } catch (err) {
        // UNIQUE (company, merch, place, day_of_week) — friendly, not raw SQL.
        setFormError(
          isDuplicateScheduleError(err)
            ? t("visits.recur.duplicate")
            : t("schedule.errorCreate")
        );
        return;
      }

      qc.invalidateQueries({ queryKey: SCHEDULES_QUERY_KEY });
      toast.success(t("visits.recur.createdOk"));

      // Materialise the anchor occurrence + rolling window through the SAME
      // generator the daily job uses. Idempotent and retryable.
      const outcome = await reconcileSchedule(scheduleId);

      if (!outcome.ok) {
        // The schedule is kept — never rolled back across requests.
        toast.warning(t("visits.recur.reconcileWarning"));
      } else {
        qc.invalidateQueries({ queryKey: ["visits"] });
      }
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  const selectCls = (hasError?: boolean) =>
    cn(
      "w-full h-11 ps-10 pe-4 rounded-xl border bg-white text-[13px] outline-none transition-all appearance-none",
      "focus:border-brand-500 focus:ring-2 focus:ring-brand-50",
      hasError ? "border-rose-400 bg-rose-50/30" : "border-ink-200"
    );

  return (
    <Modal
      onClose={onClose}
      busy={create.isPending || submitting}
      title={t("visits.add")}
      icon={<CalendarDays className="w-4 h-4 text-brand-500" />}
    >
        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="px-6 py-5 space-y-4">

          {/* Branch */}
          <div>
            <label className="block text-[12.5px] font-semibold text-ink-700 mb-1.5">
              {t("visits.assignBranch")} <span className="text-brand-500">*</span>
            </label>
            <div className="relative">
              <MapPin className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400 pointer-events-none" />
              <select {...register("place_id")} className={selectCls(!!errors.place_id)}>
                <option value="">{t("visits.assignBranchPlaceholder")}</option>
                {activePlaces.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.branch_ar} — {p.code}
                  </option>
                ))}
              </select>
            </div>
            {errors.place_id && (
              <p className="mt-1 text-[11.5px] text-rose-500">{errors.place_id.message}</p>
            )}

            {/* What the app already knows about the branch just chosen. Every
                fact here is shown on /places too — the scheduler was simply
                the one screen working blind. */}
            {ctx && (
              <div className="mt-2 rounded-xl border border-ink-100 bg-ink-50/60 px-3 py-2.5 space-y-1.5">
                <p className="flex items-center gap-1.5 text-[11px] font-bold text-ink-500 uppercase tracking-wide">
                  <Info className="w-3 h-3" />
                  {t("visits.ctx.title")}
                </p>

                <p className="flex items-center gap-1.5 text-[11.5px] text-ink-600">
                  <User className="w-3 h-3 text-ink-400 shrink-0" />
                  {ownerName
                    ? sub(t("visits.ctx.assignedTo"), { name: ownerName })
                    : <span className="text-amber-600">{t("visits.ctx.unassigned")}</span>}
                </p>

                {/* Held back until the roll-up resolves: zero products and
                    "still loading" look identical, and only one is true. */}
                {opsReady && (
                  <p className="flex items-center gap-1.5 text-[11.5px]">
                    <Package className="w-3 h-3 shrink-0 text-ink-400" />
                    {ctx.hasAssortment ? (
                      <span className="text-ink-600">
                        {ctx.requiredCount > 0
                          ? sub(t("visits.ctx.assortment"), { n: ctx.productCount, r: ctx.requiredCount })
                          : sub(t("visits.ctx.assortmentNoReq"), { n: ctx.productCount })}
                      </span>
                    ) : (
                      <span className="text-amber-600">{t("visits.ctx.noAssortment")}</span>
                    )}
                  </p>
                )}

                <p className="flex items-center gap-1.5 text-[11.5px]">
                  {ctx.hasCoords ? (
                    <>
                      <CheckCircle2 className="w-3 h-3 shrink-0 text-emerald-500" />
                      <span className="text-ink-600">{t("visits.ctx.hasCoords")}</span>
                    </>
                  ) : (
                    <>
                      <MapPinOff className="w-3 h-3 shrink-0 text-amber-500" />
                      <span className="text-amber-600">{t("visits.ctx.noCoords")}</span>
                    </>
                  )}
                </p>

                {opsReady && (
                  <p className="flex items-center gap-1.5 text-[11.5px] text-ink-600">
                    <History className="w-3 h-3 text-ink-400 shrink-0" />
                    {ctx.daysSinceVisit === null
                      ? <span className="text-ink-400">{t("visits.ctx.neverVisited")}</span>
                      : ctx.daysSinceVisit === 0
                        ? t("visits.ctx.lastVisitToday")
                        : sub(
                            t(pluralKey("visits.ctx.lastVisit", ctx.daysSinceVisit, locale) as TranslationKey),
                            { n: ctx.daysSinceVisit },
                          )}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Merchandiser */}
          <div>
            <label className="block text-[12.5px] font-semibold text-ink-700 mb-1.5">
              {t("visits.assignMerch")} <span className="text-brand-500">*</span>
            </label>
            <div className="relative">
              <User className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400 pointer-events-none" />
              <select {...register("merch_id")} className={selectCls(!!errors.merch_id)}>
                <option value="">{t("visits.assignMerchPlaceholder")}</option>
                {activeMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {merchDisplayName(m, "—")}
                  </option>
                ))}
              </select>
            </div>
            {errors.merch_id && (
              <p className="mt-1 text-[11.5px] text-rose-500">{errors.merch_id.message}</p>
            )}
            {/* Covering for a colleague is ordinary, so this informs and does
                not block — but assigning past the branch owner by accident is
                worth noticing before saving. */}
            {mismatch && ownerName && (
              <p className="mt-1.5 flex items-start gap-1.5 text-[11.5px] text-amber-700">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
                {sub(t("visits.ctx.mismatch"), { name: ownerName })}
              </p>
            )}
          </div>

          {/* Date — for a recurring plan this is the FIRST occurrence, which
              becomes the schedule's anchor_date and defines its weekday. */}
          <div>
            <label className="block text-[12.5px] font-semibold text-ink-700 mb-1.5">
              {recurring ? t("visits.recur.firstDate") : t("visits.assignDate")}{" "}
              <span className="text-brand-500">*</span>
            </label>
            <div className="relative">
              <CalendarDays className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400 pointer-events-none" />
              <input
                {...register("scheduled_date")}
                type="date"
                className={selectCls(!!errors.scheduled_date)}
              />
            </div>
          </div>

          {/* ── Recurrence ───────────────────────────────────────────────────
              Choosing anything other than "once" switches the whole submission
              from creating a Visit to creating a Schedule. Never both. */}
          <div>
            <label className="block text-[12.5px] font-semibold text-ink-700 mb-1.5">
              {t("visits.recur.label")}
            </label>
            <div className="relative">
              <Repeat className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400 pointer-events-none" />
              <select {...register("recurrence")} className={selectCls()}>
                {RECURRENCE_CHOICES.map((c) => (
                  <option key={c} value={c}>{t(RECURRENCE_LABEL[c])}</option>
                ))}
              </select>
            </div>
            <p className="mt-1.5 text-[11px] text-ink-400 leading-relaxed">
              {recurring ? t("visits.recur.hintRecurring") : t("visits.recur.hintOnce")}
            </p>

            {/* The dates this choice would actually produce, from the same
                generator the daily job uses. A schedule described in words
                alone is a promise nobody can check before saving. */}
            {preview && preview.dates.length > 0 && (
              <div className="mt-2 rounded-xl border border-brand-100 bg-brand-50/50 px-3 py-2.5">
                <p className="text-[11.5px] font-semibold text-brand-800">
                  {startTime
                    ? sub(t("visits.recur.previewDayTime"), {
                        day:  dateFmt(preview.dates[0], { weekday: "long" }),
                        time: startTime,
                      })
                    : sub(t("visits.recur.previewDay"), {
                        day: dateFmt(preview.dates[0], { weekday: "long" }),
                      })}
                </p>
                <p className="mt-1 text-[11px] text-brand-700/80">
                  {sub(t("visits.recur.previewNext"), {
                    dates: preview.dates
                      .map((d) => dateFmt(d, { day: "numeric", month: "long" }))
                      .join(" · "),
                  })}
                </p>
                {recurrence === "monthly" && (
                  <p className="mt-1 text-[10.5px] text-brand-700/70 leading-relaxed">
                    {t("visits.recur.previewMonthly")}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Time — recurring only. `visits` has no planned-time column, so for
              a one-time visit this field is not shown and never submitted
              rather than silently discarded. */}
          {recurring && (
            <div>
              <label className="block text-[12.5px] font-semibold text-ink-700 mb-1.5">
                {t("visits.recur.startTime")} <span className="text-brand-500">*</span>
              </label>
              <div className="relative">
                <Clock className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400 pointer-events-none" />
                <input {...register("start_time")} type="time" className={selectCls()} dir="ltr" />
              </div>
            </div>
          )}

          {/* Template (optional) */}
          <div>
            <label className="block text-[12.5px] font-semibold text-ink-700 mb-1.5">
              {t("visits.assignTemplate")}
              <span className="ms-1.5 text-[11px] font-normal text-ink-400">
                ({t("common.optional")})
              </span>
            </label>
            <div className="relative">
              <FileText className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400 pointer-events-none" />
              <select {...register("template_id")} className={selectCls()}>
                <option value="">{t("visits.assignTemplatePlaceholder")}</option>
                {assignableTemplates.map((tmpl) => (
                  <option key={tmpl.id} value={tmpl.id}>
                    {tmpl.name_ar} / {tmpl.name_en}
                    {" — "}
                    {fieldCountLabel(tmpl.field_count, locale, t)}
                  </option>
                ))}
                {emptyTemplates.map((tmpl) => (
                  <option key={tmpl.id} value={tmpl.id} disabled>
                    {tmpl.name_ar} / {tmpl.name_en} — {t("visits.templateEmptyOption")}
                  </option>
                ))}
                {draftTemplates.map((tmpl) => (
                  <option key={tmpl.id} value={tmpl.id} disabled>
                    {tmpl.name_ar} / {tmpl.name_en} — {t("visits.templateDraftOption")}
                  </option>
                ))}
              </select>
            </div>
            {assignableTemplates.length === 0 && (
              <p className="mt-1 text-[11px] text-ink-400">
                {t("visits.noActiveTemplates")}
              </p>
            )}
            {emptyTemplates.length > 0 && (
              <p className="mt-1 text-[11px] text-amber-600">
                {t("visits.emptyTemplatesHint")}
              </p>
            )}
            {draftTemplates.length > 0 && (
              <p className="mt-1 text-[11px] text-amber-600">
                {t("visits.draftTemplatesHint")}
              </p>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-[12.5px] font-semibold text-ink-700 mb-1.5">
              {t("visits.notes")}
            </label>
            <textarea
              {...register("notes")}
              rows={2}
              placeholder={t("visits.notesPlaceholder")}
              className="w-full px-4 py-3 rounded-xl border border-ink-200 bg-white text-[13px] text-ink-800 placeholder:text-ink-300 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-50 transition-all resize-none"
            />
          </div>

          {formError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50/70 px-3 py-2.5"
            >
              <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-px" aria-hidden="true" />
              <p className="text-[12px] text-rose-700 leading-relaxed">{formError}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-11 rounded-xl border border-ink-200 text-ink-700 text-[13.5px] font-semibold hover:bg-ink-50 transition-all"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={create.isPending || submitting}
              className="flex-1 h-11 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white text-[13.5px] font-semibold shadow-pop transition-all"
            >
              {create.isPending || submitting ? t("common.loading") : t("common.save")}
            </button>
          </div>
        </form>
    </Modal>
  );
}
