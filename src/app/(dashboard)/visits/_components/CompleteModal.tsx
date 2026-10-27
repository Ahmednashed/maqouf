"use client";

import { useRef, useState } from "react";
import { CheckCircle, Loader2, Package, AlertTriangle, FileText, MapPin } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Modal } from "@/components/ui/Modal";
import {
  deriveVisitReadiness,
  hasRequiredGaps,
  type ReadinessKind,
} from "@/lib/visit-readiness";
import type { VisitProductPlan, VisitFieldPlan } from "@/lib/visit-plan";
import type { DirtyState } from "@/lib/visit-dirty";
import type { TranslationKey } from "@/lib/i18n/translations";
import { useTranslation } from "@/hooks/use-translation";
import { pluralKey } from "@/lib/i18n/plural";
import { useCompleteVisit } from "@/hooks/use-visits";
import {
  completionDialogView,
  createCompletionGuard,
  saveThenComplete,
  type CompletionCloseSource,
} from "@/lib/visit-completion";
import type { VisitWithDetails } from "@/services/visits";
import { merchDisplayName } from "@/lib/utils/member-name";

/**
 * Base key per outstanding thing. Order comes from the readiness deriver.
 *
 * Three of these carry a count and are resolved through pluralKey at render:
 * Arabic needs six agreement forms, so the KEY has to vary, not just the number
 * substituted into it. `gps_missing` has no count and stays a plain key.
 */
const GAP_KEY: Record<ReadinessKind, string> = {
  required_fields:    "visits.ready.fields",
  required_products:  "visits.ready.reqProducts",
  unchecked_products: "visits.ready.unchecked",
  gps_missing:        "visits.ready.gpsMissing",
};

interface CompleteModalProps {
  visit:    VisitWithDetails;
  /**
   * Plans from the detail page, as the visit will stand once unsaved edits
   * are saved — completing saves them first, so that is what is completed.
   */
  productPlan: VisitProductPlan;
  fieldPlan:   VisitFieldPlan | null;
  /** Local edits the server has not got. */
  dirty:       DirtyState;
  isOnline:    boolean;
  saving:      boolean;
  /**
   * The page's existing handleSave — no new persistence path. Resolves true
   * only when everything was saved.
   */
  onSaveNow:   () => Promise<boolean>;
  /** The page's edit revision (bumped on every local edit). */
  editRevision: () => number;
  /** Extra notes from the audit textarea (passed from parent) */
  notes:    string;
  onClose:  () => void;
  /**
   * Called after successful completion, with the edit revision that was
   * completed. The page clears the local draft only if nothing was edited
   * since.
   */
  onDone:   (completedRevision: number | null) => void;
}

export function CompleteModal({
  visit,
  productPlan,
  fieldPlan,
  dirty,
  isOnline,
  saving,
  onSaveNow,
  editRevision,
  notes,
  onClose,
  onDone,
}: CompleteModalProps) {
  const { t, locale }  = useTranslation();
  const complete        = useCompleteVisit();
  const [extraNotes, setExtraNotes] = useState(notes);
  const [acked, setAcked]           = useState(false);
  const [working, setWorking]       = useState(false);
  /** Why the last attempt stopped, shown until the next one. */
  const [stopped, setStopped]       = useState<"saveFailed" | "offline" | "changedDuringSave" | "completeFailed" | null>(null);
  // Holds the dialog open while an operation runs. Kept in a ref and checked
  // in the close handler, so it holds from the very first moment — before the
  // re-render that disables the buttons.
  const guard = useRef(createCompletionGuard()).current;
  function requestClose(source: CompletionCloseSource) {
    guard.requestClose(source, onClose);
  }

  // ── Readiness ───────────────────────────────────────────────────────────────
  // The previous summary counted only quantities below the branch minimum,
  // which can only be non-zero once something has actually been counted — so
  // the dialog was silent precisely when nothing had been done. It also never
  // looked at the form.
  const readiness  = deriveVisitReadiness({ productPlan, fieldPlan, visit });

  // Completing needs the connection: unsaved edits are saved first, and the
  // completion request itself is never queued for later. Offline, the button
  // is unavailable — there is no acknowledgement that bypasses it.
  const needsAck   = hasRequiredGaps(readiness);
  const busy       = working || saving || complete.isPending;
  const view       = completionDialogView({ isOnline, dirty: dirty.dirty, needsAck, acked, busy });
  const blocked    = view.block !== null;

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
    if (blocked || busy || !guard.begin()) return;
    setStopped(null);
    setWorking(true);
    try {
      const outcome = await saveThenComplete({
        dirty:    dirty.dirty,
        // Read live, not from the prop captured at render: the connection can
        // drop during the save.
        isOnline: () => (typeof navigator === "undefined" ? true : navigator.onLine),
        save:     onSaveNow,
        complete: () => complete.mutateAsync({ id: visit.id, notes: extraNotes || undefined }),
        revision: editRevision,
      });
      if (outcome.kind === "completed") {
        guard.end();
        onDone(outcome.revision);
        return;
      }
      // Every other outcome is said inside the dialog as well. A failed
      // completion also raises the mutation's error toast, but the dialog
      // must not depend on it.
      setStopped(outcome.kind);
    } finally {
      guard.end();
      setWorking(false);
    }
  }

  // The shared Modal makes this a real dialog: labelled, aria-modal, Tab kept
  // inside, focus held on it while busy, the page behind unreachable. Esc,
  // the backdrop and its X all arrive through the Modal's close callback,
  // which goes through the guard; Modal also ignores them itself while busy.
  return (
    <Modal
      onClose={() => requestClose("dismiss")}
      title={t("visits.confirmCompleteTitle")}
      icon={<CheckCircle className="w-4 h-4 text-emerald-500" />}
      size="sm"
      busy={busy}
      scrollable
    >
      <div className="px-6 py-5 overflow-y-auto" aria-busy={busy}>
        <p className="text-[13px] text-ink-500 mb-5">
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
              {t(pluralKey("visits.productsChecked", checked, locale) as TranslationKey)
                .replace("{n}", String(checked))}
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
              {sub(
                t(pluralKey("visits.ready.belowMin", readiness.belowMinCount, locale) as TranslationKey),
                { n: readiness.belowMinCount },
              )}
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
            {view.unsavedMessage && (
              <p className="mt-1 ms-6 text-[12px] text-rose-700">{t(view.unsavedMessage)}</p>
            )}
            <ul className="mt-1.5 ms-6 space-y-0.5 list-disc">
              {dirty.changedProducts > 0 && (
                <li className="text-[12px] text-rose-700">
                  {sub(
                    t(pluralKey("visits.unsaved.products", dirty.changedProducts, locale) as TranslationKey),
                    { n: dirty.changedProducts },
                  )}
                </li>
              )}
              {dirty.changedResponses > 0 && (
                <li className="text-[12px] text-rose-700">
                  {sub(
                    t(pluralKey("visits.unsaved.responses", dirty.changedResponses, locale) as TranslationKey),
                    { n: dirty.changedResponses },
                  )}
                </li>
              )}
            </ul>

          </div>
        )}

        {/* ── Why the last attempt stopped ────────────────────────────────
            Announced, because the dialog stays open and nothing else on
            screen changes when a save fails. */}
        {stopped && (
          <p role="alert" className="flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 p-3 mb-4 text-[12.5px] text-rose-800 leading-snug">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
            {stopped === "saveFailed" ? t("visits.unsaved.saveFailed")
             : stopped === "changedDuringSave" ? t("visits.unsaved.changedDuringSave")
             : stopped === "completeFailed" ? t("visits.unsaved.completeFailed")
             : t("visits.unsaved.offlineBlocked")}
          </p>
        )}

        {/* ── In progress ──────────────────────────────────────────────────
            Says why the dialog cannot be closed right now. */}
        {busy && (
          <p role="status" className="flex items-center gap-2 rounded-xl bg-ink-50 border border-ink-100 p-3 mb-4 text-[12.5px] text-ink-700">
            <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
            {dirty.dirty ? t("visits.completing.saving") : t("visits.completing.completing")}
          </p>
        )}

        {view.offlineNotice && (
          <p className="flex items-start gap-2 text-[12.5px] text-amber-800 mb-4 leading-snug">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
            {t(view.offlineNotice)}
          </p>
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
                    ? t(GAP_KEY[g.kind] as TranslationKey)
                    : sub(
                        t(pluralKey(GAP_KEY[g.kind], g.count, locale) as TranslationKey),
                        { n: g.count },
                      )}
                </li>
              ))}
            </ul>

            {needsAck && (
              <label className="mt-3 flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={acked}
                  disabled={busy}
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
            disabled={busy}
            rows={2}
            placeholder={t("visits.notesPlaceholder")}
            className="w-full px-3 py-2.5 rounded-xl border border-ink-200 bg-white text-[13px] text-ink-800 placeholder:text-ink-300 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-50 transition-all resize-none"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={() => requestClose("cancel")}
            disabled={busy}
            className="flex-1 h-11 rounded-xl border border-ink-200 text-ink-700 text-[13.5px] font-semibold hover:bg-ink-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleConfirm}
            disabled={view.confirmDisabled}
            aria-busy={busy}
            title={view.confirmTitle ? t(view.confirmTitle) : undefined}
            className="flex-1 h-11 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 disabled:cursor-not-allowed text-white text-[13.5px] font-semibold shadow-pop transition-all flex items-center justify-center gap-2"
          >
            {busy ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="sr-only">{dirty.dirty ? t("visits.unsaved.saving") : t("visits.complete")}</span>
              </>
            ) : (
              t(view.confirmLabel)
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
