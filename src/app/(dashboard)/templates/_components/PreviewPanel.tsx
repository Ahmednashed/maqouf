"use client";

import {
  Type, Hash, ToggleLeft, CircleDot, CheckSquare,
  Camera, CalendarDays, ScanLine, AlignLeft, MapPin,
  ChevronDown,
} from "lucide-react";
import { useTranslation } from "@/hooks/use-translation";
import type { TemplateFieldFull } from "@/types";

// ─── Props ────────────────────────────────────────────────────────────────────

interface PreviewPanelProps {
  fields: TemplateFieldFull[];
}

// ─── Field renderer ───────────────────────────────────────────────────────────

function FieldPreview({ field, locale }: { field: TemplateFieldFull; locale: string }) {
  const label    = locale === "ar" ? field.label_ar : field.label_en;
  const helpText = locale === "ar" ? field.help_text_ar : field.help_text_en;
  const dir      = locale === "ar" ? "rtl" : "ltr";

  const labelEl = (
    <p className="text-[12.5px] font-semibold text-ink-700 mb-1.5" dir={dir}>
      {label || <span className="text-ink-300 italic">No label</span>}
      {field.required && <span className="text-rose-500 ms-0.5">*</span>}
    </p>
  );

  const helpEl = helpText ? (
    <p className="mt-1 text-[11px] text-ink-400" dir={dir}>{helpText}</p>
  ) : null;

  const inputBase =
    "w-full h-10 px-3 rounded-lg border border-ink-200 bg-ink-50 text-[12.5px] text-ink-400 flex items-center select-none cursor-default";

  switch (field.type) {

    // ── Text ──────────────────────────────────────────────────────────────────
    case "text":
      return (
        <div>
          {labelEl}
          <div className={inputBase} dir={dir}>
            <Type className="w-3.5 h-3.5 me-2 opacity-40 shrink-0" />
            <span className="opacity-50">
              {locale === "ar" ? "نص حر…" : "Free text…"}
            </span>
          </div>
          {helpEl}
        </div>
      );

    // ── Numeric ───────────────────────────────────────────────────────────────
    case "numeric":
      return (
        <div>
          {labelEl}
          <div className="flex items-center gap-2">
            <button className="w-8 h-8 rounded-lg border border-ink-200 bg-ink-50 flex items-center justify-center text-ink-400 text-lg cursor-default select-none">−</button>
            <div className="flex-1 h-10 rounded-lg border border-ink-200 bg-ink-50 flex items-center justify-center text-[12.5px] text-ink-400 cursor-default select-none">0</div>
            <button className="w-8 h-8 rounded-lg border border-ink-200 bg-ink-50 flex items-center justify-center text-ink-400 text-lg cursor-default select-none">+</button>
          </div>
          {helpEl}
        </div>
      );

    // ── Yes / No ──────────────────────────────────────────────────────────────
    case "yesno":
      return (
        <div>
          {labelEl}
          <div className="flex gap-3">
            {[
              { val: locale === "ar" ? "نعم" : "Yes", color: "text-emerald-600 border-emerald-200 bg-emerald-50" },
              { val: locale === "ar" ? "لا"  : "No",  color: "text-rose-600 border-rose-200 bg-rose-50" },
            ].map(({ val, color }) => (
              <div
                key={val}
                className={`flex-1 h-10 rounded-lg border ${color} flex items-center justify-center gap-2 text-[12.5px] font-medium cursor-default select-none`}
              >
                <span className="w-3.5 h-3.5 rounded-full border-2 border-current opacity-60 shrink-0" />
                {val}
              </div>
            ))}
          </div>
          {helpEl}
        </div>
      );

    // ── Single choice ─────────────────────────────────────────────────────────
    case "single": {
      const opts = field.options ?? [];
      return (
        <div>
          {labelEl}
          {opts.length === 0 ? (
            <p className="text-[11.5px] text-ink-300 italic">
              {locale === "ar" ? "لا توجد خيارات بعد" : "No options yet"}
            </p>
          ) : (
            <div className="space-y-1.5">
              {opts.map((o) => (
                <div key={o} className="flex items-center gap-2.5 px-3 h-9 rounded-lg border border-ink-200 bg-ink-50 cursor-default select-none">
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-ink-300 shrink-0" />
                  <span className="text-[12.5px] text-ink-600" dir={dir}>{o}</span>
                </div>
              ))}
            </div>
          )}
          {helpEl}
        </div>
      );
    }

    // ── Multiple choice ───────────────────────────────────────────────────────
    case "multiple": {
      const opts = field.options ?? [];
      return (
        <div>
          {labelEl}
          {opts.length === 0 ? (
            <p className="text-[11.5px] text-ink-300 italic">
              {locale === "ar" ? "لا توجد خيارات بعد" : "No options yet"}
            </p>
          ) : (
            <div className="space-y-1.5">
              {opts.map((o) => (
                <div key={o} className="flex items-center gap-2.5 px-3 h-9 rounded-lg border border-ink-200 bg-ink-50 cursor-default select-none">
                  <span className="w-3.5 h-3.5 rounded-md border-2 border-ink-300 shrink-0" />
                  <span className="text-[12.5px] text-ink-600" dir={dir}>{o}</span>
                </div>
              ))}
            </div>
          )}
          {helpEl}
        </div>
      );
    }

    // ── Photo ─────────────────────────────────────────────────────────────────
    case "photo":
      return (
        <div>
          {labelEl}
          <div className="h-20 rounded-xl border-2 border-dashed border-ink-200 bg-ink-50 flex flex-col items-center justify-center gap-1 cursor-default select-none">
            <Camera className="w-6 h-6 text-ink-300" />
            <span className="text-[11px] text-ink-400">
              {locale === "ar" ? "التقط صورة" : "Take a photo"}
            </span>
          </div>
          {helpEl}
        </div>
      );

    // ── Date ──────────────────────────────────────────────────────────────────
    case "date":
      return (
        <div>
          {labelEl}
          <div className={`${inputBase} justify-between`} dir={dir}>
            <span className="opacity-50">
              {locale === "ar" ? "اختر تاريخاً" : "Select a date"}
            </span>
            <CalendarDays className="w-4 h-4 opacity-40" />
          </div>
          {helpEl}
        </div>
      );

    // ── Barcode ───────────────────────────────────────────────────────────────
    case "barcode":
      return (
        <div>
          {labelEl}
          <div className="h-14 rounded-xl border-2 border-dashed border-ink-200 bg-ink-50 flex items-center justify-center gap-2 cursor-default select-none">
            <ScanLine className="w-5 h-5 text-ink-300" />
            <span className="text-[12px] text-ink-400">
              {locale === "ar" ? "امسح الباركود" : "Scan barcode"}
            </span>
          </div>
          {helpEl}
        </div>
      );

    // ── Section title ─────────────────────────────────────────────────────────
    case "section":
      return (
        <div className="pt-1 pb-0.5">
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-ink-200" />
            <span className="text-[12.5px] font-bold text-ink-500 uppercase tracking-wide" dir={dir}>
              {label || (locale === "ar" ? "عنوان القسم" : "Section Title")}
            </span>
            <div className="flex-1 h-px bg-ink-200" />
          </div>
        </div>
      );

    // ── Location ──────────────────────────────────────────────────────────────
    case "location":
      return (
        <div>
          {labelEl}
          <div className="rounded-xl border border-ink-200 bg-ink-50 overflow-hidden cursor-default select-none">
            {/* Mock map tile */}
            <div className="h-24 bg-gradient-to-br from-emerald-50 to-teal-100 flex items-center justify-center relative">
              <div className="w-8 h-8 rounded-full bg-white shadow-md flex items-center justify-center">
                <MapPin className="w-4 h-4 text-rose-500" />
              </div>
              <div className="absolute bottom-1.5 end-2 text-[9px] text-ink-400 bg-white/70 rounded px-1 py-0.5">
                {locale === "ar" ? "خريطة وهمية" : "Mock map"}
              </div>
            </div>
            {/* Coordinate row */}
            <div className="px-3 py-2 flex items-center gap-2">
              <MapPin className="w-3.5 h-3.5 text-ink-400 shrink-0" />
              <span className="text-[11.5px] text-ink-400">
                {locale === "ar" ? "سيتم التقاط الإحداثيات تلقائياً" : "Coordinates will be captured automatically"}
              </span>
            </div>
          </div>
          {helpEl}
        </div>
      );

    default:
      return null;
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

export function PreviewPanel({ fields }: PreviewPanelProps) {
  const { t, locale } = useTranslation();

  if (fields.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[320px] text-center px-6">
        <div className="w-14 h-14 rounded-2xl bg-ink-100 flex items-center justify-center mb-3">
          <AlignLeft className="w-6 h-6 text-ink-400" />
        </div>
        <p className="text-[13.5px] font-semibold text-ink-600">
          {t("templates.previewEmpty")}
        </p>
        <p className="text-[12px] text-ink-400 mt-1">
          {t("templates.previewEmptyHint")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 px-1">
      {fields.map((field) => (
        <FieldPreview key={field.id} field={field} locale={locale} />
      ))}
    </div>
  );
}
