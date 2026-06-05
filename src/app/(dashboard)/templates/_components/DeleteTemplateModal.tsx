"use client";

import { Trash2, X, AlertTriangle } from "lucide-react";
import { useTranslation } from "@/hooks/use-translation";
import { useDeleteTemplate } from "@/hooks/use-templates";
import type { TemplateListItem } from "@/types";

// ─── Props ────────────────────────────────────────────────────────────────────

interface DeleteTemplateModalProps {
  template: TemplateListItem;
  onClose:  () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DeleteTemplateModal({ template, onClose }: DeleteTemplateModalProps) {
  const { t, locale } = useTranslation();
  const del            = useDeleteTemplate();

  const name = locale === "ar" ? template.name_ar : template.name_en;

  async function handleDelete() {
    await del.mutateAsync(template.id);
    onClose();
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
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-ink-100">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-rose-50 flex items-center justify-center">
              <Trash2 className="w-4 h-4 text-rose-500" />
            </div>
            <h2 className="text-[16px] font-bold text-ink-900">
              {t("templates.deleteTitle")}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-400 hover:text-ink-700 hover:bg-ink-100 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {/* Warning banner */}
          <div className="flex gap-3 p-3.5 rounded-xl bg-rose-50 border border-rose-100">
            <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
            <p className="text-[12.5px] text-rose-700 leading-relaxed">
              {t("templates.deleteWarning")}
            </p>
          </div>

          {/* Template name chip */}
          <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border border-ink-200 bg-ink-50">
            <Trash2 className="w-4 h-4 text-ink-400 shrink-0" />
            <span className="text-[13px] font-semibold text-ink-800">{name}</span>
            {template.field_count > 0 && (
              <span className="ms-auto text-[11.5px] text-ink-400">
                {template.field_count} {t("templates.fieldsCount")}
              </span>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={del.isPending}
              className="flex-1 h-11 rounded-xl border border-ink-200 text-ink-700 text-[13.5px] font-semibold hover:bg-ink-50 disabled:opacity-60 transition-all"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={del.isPending}
              className="flex-1 h-11 rounded-xl bg-rose-500 hover:bg-rose-600 disabled:opacity-60 text-white text-[13.5px] font-semibold shadow-pop transition-all"
            >
              {del.isPending ? t("common.loading") : t("common.delete")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
