"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { X, Store, Hash, Palette } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/hooks/use-translation";
import { useCreateChain, useUpdateChain } from "@/hooks/use-chains";
import type { Chain } from "@/types";

// ─── Preset colour palette ────────────────────────────────────────────────────
const PRESET_COLORS = [
  "#111827", "#EF4444", "#F97316", "#F59E0B",
  "#10B981", "#3B82F6", "#8B5CF6", "#EC4899",
  "#0EA5E9", "#14B8A6",
];

// ─── Zod schema ───────────────────────────────────────────────────────────────
const chainSchema = z.object({
  name_ar:   z.string().min(2, "الاسم العربي مطلوب"),
  name_en:   z.string().min(2, "English name is required"),
  code:      z
    .string()
    .min(2, "الكود مطلوب")
    .max(10, "الكود لا يتجاوز 10 أحرف")
    .regex(/^[A-Z0-9_-]+$/, "أحرف كبيرة، أرقام، - أو _ فقط"),
  color:     z.string().default("#111827"),
  is_active: z.boolean().default(true),
});

type ChainFormData = z.infer<typeof chainSchema>;

// ─── Props ────────────────────────────────────────────────────────────────────
interface ChainModalProps {
  /** When set the modal is in edit mode; otherwise create mode. */
  chain?: Chain | null;
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────
export function ChainModal({ chain, onClose }: ChainModalProps) {
  const { t }      = useTranslation();
  const isEdit     = Boolean(chain);
  const create     = useCreateChain();
  const update     = useUpdateChain();
  const isPending  = create.isPending || update.isPending;

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<ChainFormData>({
    resolver: zodResolver(chainSchema),
    defaultValues: {
      name_ar:   chain?.name_ar   ?? "",
      name_en:   chain?.name_en   ?? "",
      code:      chain?.code      ?? "",
      color:     chain?.color     ?? "#111827",
      is_active: chain?.is_active ?? true,
    },
  });

  const selectedColor = watch("color");
  const isActive      = watch("is_active");

  // Re-populate when the chain prop changes (switching between rows to edit).
  useEffect(() => {
    reset({
      name_ar:   chain?.name_ar   ?? "",
      name_en:   chain?.name_en   ?? "",
      code:      chain?.code      ?? "",
      color:     chain?.color     ?? "#111827",
      is_active: chain?.is_active ?? true,
    });
  }, [chain, reset]);

  // ── Submit ──────────────────────────────────────────────────────────────────
  async function onSubmit(data: ChainFormData) {
    if (isEdit && chain) {
      await update.mutateAsync({ id: chain.id, payload: data });
    } else {
      await create.mutateAsync(data);
    }
    onClose();
  }

  // ── Input class helper ──────────────────────────────────────────────────────
  const inputCls = (hasError?: boolean) =>
    cn(
      "w-full h-11 ps-10 pe-4 rounded-xl border bg-white text-[13px] outline-none transition-all",
      "placeholder:text-ink-300",
      "focus:border-brand-500 focus:ring-2 focus:ring-brand-50",
      hasError ? "border-rose-400 bg-rose-50/30" : "border-ink-200"
    );

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm animate-fade-in" />

      {/* Panel */}
      <div
        className="relative w-full max-w-lg bg-white rounded-2xl shadow-modal border border-ink-100 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-ink-100">
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: selectedColor + "22" }}
            >
              <Store className="w-4 h-4" style={{ color: selectedColor }} />
            </div>
            <h2 className="text-[16px] font-bold text-ink-900">
              {isEdit ? t("chains.edit") : t("chains.add")}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-400 hover:text-ink-700 hover:bg-ink-100 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="px-6 py-5 space-y-4">

          {/* Arabic Name */}
          <div>
            <label className="block text-[12.5px] font-semibold text-ink-700 mb-1.5">
              {t("chains.nameAr")} <span className="text-brand-500">*</span>
            </label>
            <div className="relative">
              <Store className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400 pointer-events-none" />
              <input
                {...register("name_ar")}
                dir="rtl"
                placeholder="مثال: لولو هايبر ماركت"
                className={inputCls(!!errors.name_ar)}
              />
            </div>
            {errors.name_ar && (
              <p className="mt-1 text-[11.5px] text-rose-500">{errors.name_ar.message}</p>
            )}
          </div>

          {/* English Name */}
          <div>
            <label className="block text-[12.5px] font-semibold text-ink-700 mb-1.5">
              {t("chains.nameEn")} <span className="text-brand-500">*</span>
            </label>
            <div className="relative">
              <Store className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400 pointer-events-none" />
              <input
                {...register("name_en")}
                dir="ltr"
                placeholder="e.g. Lulu Hypermarket"
                className={inputCls(!!errors.name_en)}
              />
            </div>
            {errors.name_en && (
              <p className="mt-1 text-[11.5px] text-rose-500">{errors.name_en.message}</p>
            )}
          </div>

          {/* Code */}
          <div>
            <label className="block text-[12.5px] font-semibold text-ink-700 mb-1.5">
              {t("chains.code")} <span className="text-brand-500">*</span>
            </label>
            <div className="relative">
              <Hash className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400 pointer-events-none" />
              <input
                {...register("code")}
                dir="ltr"
                placeholder="LULU"
                maxLength={10}
                className={inputCls(!!errors.code)}
                // Auto-uppercase as the user types
                onChange={(e) =>
                  setValue("code", e.target.value.toUpperCase(), {
                    shouldValidate: true,
                  })
                }
              />
            </div>
            <p className="mt-1 text-[11px] text-ink-400">{t("chains.codeHint")}</p>
            {errors.code && (
              <p className="mt-0.5 text-[11.5px] text-rose-500">{errors.code.message}</p>
            )}
          </div>

          {/* Color picker */}
          <div>
            <label className="block text-[12.5px] font-semibold text-ink-700 mb-2">
              <Palette className="inline w-3.5 h-3.5 me-1 text-ink-400" />
              {t("chains.color")}
            </label>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  title={c}
                  onClick={() => setValue("color", c)}
                  className={cn(
                    "w-7 h-7 rounded-lg border-2 transition-all",
                    selectedColor === c
                      ? "border-ink-900 scale-110 shadow-pop"
                      : "border-transparent hover:scale-105"
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
              {/* Custom hex input */}
              <div className="relative flex items-center">
                <span
                  className="w-7 h-7 rounded-lg border-2 border-ink-200 cursor-pointer"
                  style={{ backgroundColor: selectedColor }}
                />
                <input
                  type="color"
                  value={selectedColor}
                  onChange={(e) => setValue("color", e.target.value)}
                  className="absolute inset-0 opacity-0 w-7 h-7 cursor-pointer"
                  title="Custom color"
                />
              </div>
            </div>
          </div>

          {/* Status toggle */}
          <div className="flex items-center justify-between py-2 px-3 rounded-xl bg-ink-50 border border-ink-100">
            <span className="text-[13px] font-medium text-ink-700">
              {t("common.status")}
            </span>
            <button
              type="button"
              onClick={() => setValue("is_active", !isActive)}
              className={cn(
                "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                isActive ? "bg-brand-500" : "bg-ink-200"
              )}
            >
              <span
                className={cn(
                  "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
                  isActive ? "translate-x-6" : "translate-x-1"
                )}
              />
            </button>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-11 rounded-xl border border-ink-200 text-ink-700 text-[13.5px] font-semibold hover:bg-ink-50 transition-all"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex-1 h-11 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white text-[13.5px] font-semibold shadow-pop transition-all"
            >
              {isPending ? t("common.loading") : t("common.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
