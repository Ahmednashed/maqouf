"use client";

import { AlertTriangle, Trash2, X } from "lucide-react";
import { useTranslation } from "@/hooks/use-translation";
import { useDeletePlace } from "@/hooks/use-places";
import type { PlaceWithChain } from "@/services/places";

interface DeleteModalProps {
  place:   PlaceWithChain;
  onClose: () => void;
}

export function DeleteModal({ place, onClose }: DeleteModalProps) {
  const { t, locale } = useTranslation();
  const deletePlace   = useDeletePlace();

  const branchName = locale === "ar" ? place.branch_ar : place.branch_en;
  const chainColor = place.chain?.color ?? "#111827";
  const chainName  = place.chain
    ? (locale === "ar" ? place.chain.name_ar : place.chain.name_en)
    : "";

  async function handleDelete() {
    await deletePlace.mutateAsync(place.id);
    onClose();
  }

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm animate-fade-in" />

      {/* Panel */}
      <div
        className="relative w-full max-w-sm bg-white rounded-2xl shadow-modal border border-ink-100 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 end-4 w-7 h-7 rounded-lg flex items-center justify-center text-ink-400 hover:text-ink-700 hover:bg-ink-100 transition-all"
        >
          <X className="w-3.5 h-3.5" />
        </button>

        {/* Body */}
        <div className="px-6 pt-8 pb-6 text-center">
          {/* Warning icon */}
          <div className="w-14 h-14 rounded-2xl bg-rose-50 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-7 h-7 text-rose-500" />
          </div>

          <h2 className="text-[16px] font-bold text-ink-900 mb-1">
            {t("places.confirmDeleteTitle")}
          </h2>

          {/* Place name pill */}
          <div
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-semibold text-white my-2"
            style={{ backgroundColor: chainColor }}
          >
            {branchName}
            {chainName && (
              <span className="opacity-70">· {chainName}</span>
            )}
          </div>

          <p className="text-[12.5px] text-ink-500 leading-relaxed mt-2">
            {t("places.confirmDeleteMsg")}
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-3 px-6 pb-6">
          <button
            onClick={onClose}
            className="flex-1 h-10 rounded-xl border border-ink-200 text-ink-700 text-[13px] font-semibold hover:bg-ink-50 transition-all"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleDelete}
            disabled={deletePlace.isPending}
            className="flex-1 h-10 rounded-xl bg-rose-500 hover:bg-rose-600 disabled:opacity-60 text-white text-[13px] font-semibold flex items-center justify-center gap-1.5 transition-all"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {deletePlace.isPending ? t("common.loading") : t("common.delete")}
          </button>
        </div>
      </div>
    </div>
  );
}
