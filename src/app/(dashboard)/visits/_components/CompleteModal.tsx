"use client";

import { useState } from "react";
import { CheckCircle, X, Loader2, Package, AlertTriangle } from "lucide-react";
import { useTranslation } from "@/hooks/use-translation";
import { useCompleteVisit } from "@/hooks/use-visits";
import type { VisitWithDetails } from "@/services/visits";
import type { VisitProductWithDetails } from "@/services/visit-products";

interface CompleteModalProps {
  visit:    VisitWithDetails;
  products: VisitProductWithDetails[];
  /** Extra notes from the audit textarea (passed from parent) */
  notes:    string;
  onClose:  () => void;
  /** Called after successful completion */
  onDone:   () => void;
}

export function CompleteModal({
  visit,
  products,
  notes,
  onClose,
  onDone,
}: CompleteModalProps) {
  const { t, locale }  = useTranslation();
  const complete        = useCompleteVisit();
  const [extraNotes, setExtraNotes] = useState(notes);

  // ── Summary stats ───────────────────────────────────────────────────────────
  const checked  = products.filter((p) => p.qty_found !== null).length;
  const missing  = products.filter(
    (p) => p.qty_found !== null && p.qty_found < p.min_stock
  ).length;
  const totalProducts = products.length;

  const branchName =
    locale === "ar" ? visit.place.branch_ar : visit.place.branch_en;
  const merchName  = visit.merch.user.full_name;

  async function handleConfirm() {
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

            <div className="flex items-center justify-between text-[13px]">
              <span className="flex items-center gap-1.5 text-ink-600">
                <Package className="w-3.5 h-3.5" />
                {t("visits.productsChecked").replace("{n}", String(checked))}
              </span>
              <span className="text-ink-400 text-[12px]">/ {totalProducts}</span>
            </div>

            {missing > 0 && (
              <div className="flex items-center gap-1.5 text-[13px] text-amber-600">
                <AlertTriangle className="w-3.5 h-3.5" />
                {t("visits.itemsMissing").replace("{n}", String(missing))}
              </div>
            )}
          </div>

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
              disabled={complete.isPending}
              className="flex-1 h-11 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 text-white text-[13.5px] font-semibold shadow-pop transition-all flex items-center justify-center gap-2"
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
