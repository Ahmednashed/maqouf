"use client";

import { useState } from "react";
import { CheckCircle, X, Loader2, Package, AlertTriangle, FileText, MapPin } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  deriveVisitReadiness,
  hasRequiredGaps,
  type ReadinessKind,
} from "@/lib/visit-readiness";
import type { VisitProductPlan, VisitFieldPlan } from "@/lib/visit-plan";
import type { DirtyState } from "@/lib/visit-dirty";
import type { TranslationKey } from "@/lib/i18n/translations";
import { useTranslation } from "@/hooks/use-translation";
import { useCompleteVisit } from "@/hooks/use-visits";
import type { VisitWithDetails } from "@/services/visits";
import { merchDisplayName } from "@/lib/utils/member-name";

/** One line per outstanding thing. Order comes from the readiness deriver. */
const GAP_KEY: Record<ReadinessKind, TranslationKey> = {
  required_fields:    "visits.ready.fields",
  required_products:  "visits.ready.reqProducts",
  unchecked_products: "visits.ready.unchecked",
  gps_missing:        "visits.ready.gpsMissing",
};

interface CompleteModalProps {
  visit:    VisitWithDetails;
  /** Plans from the detail page — already derived there, not recomputed. */
  productPlan: VisitProductPlan;
  fieldPlan:   VisitFieldPlan | null;
  /** Local edits the server has not got. */
  dirty:       DirtyState;
  isOnline:    boolean;
  saving:      boolean;
  /** Runs the page's existing handleSave — no new persistence path. */
  onSaveNow:   () => void;
  /** Extra notes from the audit textarea (passed from parent) */
  notes:    string;
  onClose:  () => void;
  /** Called after successful completion */
  onDone:   () => void;
}

export function CompleteModal({
  visit,
  productPlan,
  fieldPlan,
  dirty,
  isOnline,
  saving,
  onSaveNow,
  notes,
  onClose,
  onDone,
}: CompleteModalProps) {
  const { t, locale }  = useTranslation();
  const complete        = useCompleteVisit();
  const [extraNotes, setExtraNotes] = useState(notes);
  const [acked, setAcked]           = useState(false);

  // ── Readiness ───────────────────────────────────────────────────────────────
  // The previous summary counted only quantities below the branch minimum,
  // which can only be non-zero once something has actually been counted — so
  // the dialog was silent precisely when nothing had been done. It also never
  // looked at the form.
  const readiness  = deriveVisitReadiness({ productPlan, fieldPlan, visit });

  // Online, saving is one click away, so unsaved work blocks outright — that
  // is the only way "complete" cannot quietly drop it. Offline it cannot be
  // saved at all, and refusing would strand a field user mid-shift, so it
  // joins the Batch 11 acknowledgement instead.
  const mustSave   = dirty.dirty && isOnline;
  const needsAck   = hasRequiredGaps(readiness) || (dirty.dirty && !isOnline);
  const blocked    = mustSave || (needsAck && !acked);

  // From the plan, not the passed-in rows: the rows carry local edit state,
  // and completing does not save it. Counting typed-but-unsaved input here
  // would contradict the warning directly below it.
  const checked       = productPlan.checkedCount;
  const totalProducts = productPlan.expectedCount;
  const sub = (key: string, vals: Record<string, string | number>) =>
    Object.entries(vals).reduce((acc, [k, v]) => acc.replace(`{${k}}`, String(v)), key);

  const branchName =
    locale === "ar" ? visit.place.branch_ar : visit.place.branch_en;
  // merch.user can be null when the auth user was hard-deleted
  const merchName  = merchDisplayName(visit.merch, "—");

  async function handleConfirm() {
    // Guarded here as well as on the button: the acknowledgement is the whole
    // point of the dialog, so it must not be bypassable by a stray call.
    if (blocked) return;
    await complete.mutateAsync({ id: visit.id, notes: extraNotes || undefined });
    onDone();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm animate-fade-in" />

      <div
        className="relative w-full max-w-sm bg-white rounded-2xl shadow-modal border border-ink-100 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 end-4 w-8 h-8 rounded-lg flex items-center justify-center text-ink-400 hover:text-ink-700 hover:bg-ink-100 transition-all"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="px-6 py-6">
          {/* Icon */}
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-7 h-7 text-emerald-500" />
          </div>

          <h2 className="text-[16px] font-bold text-ink-900 text-center mb-1">
            {t("visits.confirmCompleteTitle")}
          </h2>
          <p className="text-[13px] text-ink-500 text-center mb-5">
            {t("visits.confirmCompleteMsg")}
          </p>

          {/* Summary card */}
          <div className="rounded-xl bg-ink-50 border border-ink-100 p-4 mb-4 space-y-2">
            <p className="text-[12px] font-bold text-ink-400 uppercase tracking-wide mb-3">
              {branchName} · {merchName}
            </p>

            {fieldPlan && fieldPlan.requiredCount > 0 && (
              <div className="flex items-center justify-between text-[13px]">
                <span className="flex items-center gap-1.5 text-ink-600">
                  <FileText className="w-3.5 h-3.5" />
                  {sub(t("visits.ready.fieldsDone"), {
                    done: fieldPlan.requiredAnsweredCount, total: fieldPlan.requiredCount,
                  })}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between text-[13px]">
              <span className="flex items-center gap-1.5 text-ink-600">
                <Package className="w-3.5 h-3.5" />
                {t("visits.productsChecked").replace("{n}", String(checked))}
              </span>
              <span className="text-ink-400 text-[12px]">/ {totalProducts}</span>
            </div>

            {/* Location: stated for every visit, including the case where the
                branch has no coordinates and no check could have applied. */}
            <div className="flex items-center gap-1.5 text-[12.5px]">
              <MapPin className="w-3.5 h-3.5 shrink-0 text-ink-400" />
              <span className={cn(
                readiness.gps === "verified" ? "text-emerald-600" : "text-ink-500",
              )}>
                {readiness.gps === "verified"       ? t("visits.ready.gpsVerified")
                 : readiness.gps === "not_applicable" ? t("visits.ready.gpsNotApplicable")
                 : t("visits.ready.gpsMissing")}
              </span>
            </div>

            {readiness.belowMinCount > 0 && (
              <div className="flex items-center gap-1.5 text-[13px] text-amber-600">
                <AlertTriangle className="w-3.5 h-3.5" />
                {sub(t("visits.ready.belowMin"), { n: readiness.belowMinCount })}
              </div>
            )}
          </div>

          {/* ── Unsaved local edits ─────────────────────────────────────────
              Placed above the readiness warning because saving will change
              the very numbers that warning reports. */}
          {dirty.dirty && (
            <div className="rounded-xl border border-rose-300 bg-rose-50/80 p-3.5 mb-4">
              <p className="flex items-start gap-2 text-[12.5px] font-bold text-rose-800">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
                {t("visits.unsaved.title")}
              </p>
              <p className="mt-1 ms-6 text-[12px] text-rose-700">{t("visits.unsaved.desc")}</p>
              <ul className="mt-1.5 ms-6 space-y-0.5 list-disc">
                {dirty.changedProducts > 0 && (
                  <li className="text-[12px] text-rose-700">
                    {sub(t("visits.unsaved.products"), { n: dirty.changedProducts })}
                  </li>
                )}
                {dirty.changedResponses > 0 && (
                  <li className="text-[12px] text-rose-700">
                    {sub(t("visits.unsaved.responses"), { n: dirty.changedResponses })}
                  </li>
                )}
              </ul>

              {isOnline ? (
                <button
                  type="button"
                  onClick={onSaveNow}
                  disabled={saving}
                  className="mt-3 w-full h-10 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white text-[13px] font-semibold transition-all"
                >
                  {saving ? t("visits.unsaved.saving") : t("visits.unsaved.saveNow")}
                </button>
              ) : (
                <p className="mt-2 ms-6 text-[11.5px] text-rose-600 leading-snug">
                  {t("visits.unsaved.offline")}
                </p>
              )}
            </div>
          )}

          {/* ── What completing now would leave unrecorded ──────────────────
              completeVisit() imposes no rules, so this warns and asks for an
              explicit acknowledgement rather than blocking work that the
              business model permits. */}
          {readiness.gaps.length > 0 && (
            <div className={cn(
              "rounded-xl border p-3.5 mb-4",
              needsAck ? "border-amber-300 bg-amber-50/70" : "border-ink-200 bg-ink-50",
            )}>
              <p className={cn(
                "flex items-start gap-2 text-[12.5px] font-bold",
                needsAck ? "text-amber-800" : "text-ink-600",
              )}>
                <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
                {t("visits.ready.warnTitle")}
              </p>
              <ul className="mt-2 ms-6 space-y-1 list-disc">
                {readiness.gaps.map((g) => (
                  <li key={g.kind} className="text-[12px] text-ink-700">
                    {g.kind === "gps_missing"
                      ? t(GAP_KEY[g.kind])
                      : sub(t(GAP_KEY[g.kind]), { n: g.count })}
                  </li>
                ))}
              </ul>

              {needsAck && (
                <label className="mt-3 flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={acked}
                    onChange={(e) => setAcked(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-amber-400 accent-amber-600 shrink-0"
                  />
                  <span className="text-[12px] text-amber-900 leading-snug">
                    {t("visits.ready.ack")}
                  </span>
                </label>
              )}
            </div>
          )}

          {readiness.gaps.length === 0 && (
            <p className="flex items-center gap-2 text-[12.5px] text-emerald-700 font-medium mb-4">
              <CheckCircle className="w-4 h-4" />
              {t("visits.ready.allDone")}
            </p>
          )}

          {/* Notes */}
          <div className="mb-5">
            <label className="block text-[12.5px] font-semibold text-ink-700 mb-1.5">
              {t("visits.notes")}
            </label>
            <textarea
              value={extraNotes}
              onChange={(e) => setExtraNotes(e.target.value)}
              rows={2}
              placeholder={t("visits.notesPlaceholder")}
              className="w-full px-3 py-2.5 rounded-xl border border-ink-200 bg-white text-[13px] text-ink-800 placeholder:text-ink-300 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-50 transition-all resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 h-11 rounded-xl border border-ink-200 text-ink-700 text-[13.5px] font-semibold hover:bg-ink-50 transition-all"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={handleConfirm}
              disabled={complete.isPending || blocked}
              title={mustSave ? t("visits.unsaved.blocked") : blocked ? t("visits.ready.ackRequired") : undefined}
              className="flex-1 h-11 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 disabled:cursor-not-allowed text-white text-[13.5px] font-semibold shadow-pop transition-all flex items-center justify-center gap-2"
            >
              {complete.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                t("visits.complete")
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
