"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { X, FileText } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/hooks/use-translation";
import { useCreateTemplate, useUpdateTemplate } from "@/hooks/use-templates";
import type { TemplateListItem } from "@/types";

// ─── Schema ───────────────────────────────────────────────────────────────────

const schema = z.object({
  name_ar:     z.string().min(2, "الاسم العربي مطلوب"),
  name_en:     z.string().min(2, "English name is required"),
  description: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

// ─── Props ────────────────────────────────────────────────────────────────────

interface TemplateModalProps {
  /** Editing an existing template; undefined → create mode */
  template?: TemplateListItem | null;
  onClose:   () => void;
  /** Called after successful create with the new template id */
  onCreate?: (id: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TemplateModal({ template, onClose, onCreate }: TemplateModalProps) {
  const { t }   = useTranslation();
  const isEdit  = Boolean(template);
  const create  = useCreateTemplate();
  const update  = useUpdateTemplate();
  const pending = create.isPending || update.isPending;

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name_ar:     template?.name_ar     ?? "",
      name_en:     template?.name_en     ?? "",
      description: template?.description ?? "",
    },
  });

  useEffect(() => {
    reset({
      name_ar:     template?.name_ar     ?? "",
      name_en:     template?.name_en     ?? "",
      description: template?.description ?? "",
    });
  }, [template, reset]);

  async function onSubmit(data: FormData) {
    if (isEdit && template) {
      await update.mutateAsync({
        id:      template.id,
        payload: {
          name_ar:     data.name_ar,
          name_en:     data.name_en,
          description: data.description || undefined,
        },
      });
      onClose();
    } else {
      const newTemplate = await create.mutateAsync({
        name_ar:     data.name_ar,
        name_en:     data.name_en,
        description: data.description || undefined,
        status:      "draft",
      });
      onClose();
      onCreate?.(newTemplate.id);
    }
  }

  const inputCls = (hasError?: boolean) =>
    cn(
      "w-full h-11 px-4 rounded-xl border bg-white text-[13px] outline-none transition-all",
      "placeholder:text-ink-300",
      "focus:border-brand-500 focus:ring-2 focus:ring-brand-50",
      hasError ? "border-rose-400 bg-rose-50/30" : "border-ink-200"
    );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm animate-fade-in" />

      <div
        className="relative w-full max-w-md bg-white rounded-2xl shadow-modal border border-ink-100 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-ink-100">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center">
              <FileText className="w-4 h-4 text-brand-500" />
            </div>
            <h2 className="text-[16px] font-bold text-ink-900">
              {isEdit ? t("templates.edit") : t("templates.add")}
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

          {/* Arabic name */}
          <div>
            <label className="block text-[12.5px] font-semibold text-ink-700 mb-1.5">
              {t("templates.nameAr")} <span className="text-brand-500">*</span>
            </label>
            <input
              {...register("name_ar")}
              dir="rtl"
              placeholder="مثال: قالب مراجعة الرف"
              className={inputCls(!!errors.name_ar)}
            />
            {errors.name_ar && (
              <p className="mt-1 text-[11.5px] text-rose-500">{errors.name_ar.message}</p>
            )}
          </div>

          {/* English name */}
          <div>
            <label className="block text-[12.5px] font-semibold text-ink-700 mb-1.5">
              {t("templates.nameEn")} <span className="text-brand-500">*</span>
            </label>
            <input
              {...register("name_en")}
              dir="ltr"
              placeholder="e.g. Shelf Audit Template"
              className={inputCls(!!errors.name_en)}
            />
            {errors.name_en && (
              <p className="mt-1 text-[11.5px] text-rose-500">{errors.name_en.message}</p>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="block text-[12.5px] font-semibold text-ink-700 mb-1.5">
              {t("templates.description")}
            </label>
            <textarea
              {...register("description")}
              rows={2}
              placeholder={t("templates.descriptionPlaceholder")}
              className="w-full px-4 py-3 rounded-xl border border-ink-200 bg-white text-[13px] text-ink-800 placeholder:text-ink-300 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-50 transition-all resize-none"
            />
          </div>

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
              disabled={pending}
              className="flex-1 h-11 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white text-[13.5px] font-semibold shadow-pop transition-all"
            >
              {pending
                ? t("common.loading")
                : isEdit
                  ? t("common.save")
                  : t("templates.add")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
