"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { X, CalendarDays, MapPin, User, FileText } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/hooks/use-translation";
import { useCreateVisit } from "@/hooks/use-visits";
import { usePlaces } from "@/hooks/use-places";
import { useCompanyUsers } from "@/hooks/use-company-users";
import { useTemplates } from "@/hooks/use-templates";

// ─── Schema ───────────────────────────────────────────────────────────────────

const schema = z.object({
  place_id:       z.string().min(1, "Branch is required"),
  merch_id:       z.string().min(1, "Merchandiser is required"),
  scheduled_date: z.string().min(1, "Date is required"),
  template_id:    z.string().optional(),
  notes:          z.string().optional(),
});

type FormData = z.infer<typeof schema>;

// ─── Props ────────────────────────────────────────────────────────────────────

interface VisitCreateModalProps {
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function VisitCreateModal({ onClose }: VisitCreateModalProps) {
  const { t }    = useTranslation();
  const create   = useCreateVisit();
  const { data: places    = [] } = usePlaces();
  const { data: members   = [] } = useCompanyUsers();
  const { data: templates = [] } = useTemplates();

  const activePlaces     = places.filter((p) => p.is_active);
  const activeMembers    = members.filter((m) => m.status === "active");
  const activeTemplates  = templates.filter((t) => t.status === "active");

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      scheduled_date: new Date().toISOString().slice(0, 10),
    },
  });

  async function onSubmit(data: FormData) {
    await create.mutateAsync({
      place_id:       data.place_id,
      merch_id:       data.merch_id,
      scheduled_date: data.scheduled_date,
      template_id:    data.template_id || undefined,
      notes:          data.notes || undefined,
    });
    onClose();
  }

  const selectCls = (hasError?: boolean) =>
    cn(
      "w-full h-11 ps-10 pe-4 rounded-xl border bg-white text-[13px] outline-none transition-all appearance-none",
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
          <h2 className="text-[16px] font-bold text-ink-900">{t("visits.add")}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-400 hover:text-ink-700 hover:bg-ink-100 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

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
                    {m.user?.full_name ?? "—"}
                  </option>
                ))}
              </select>
            </div>
            {errors.merch_id && (
              <p className="mt-1 text-[11.5px] text-rose-500">{errors.merch_id.message}</p>
            )}
          </div>

          {/* Date */}
          <div>
            <label className="block text-[12.5px] font-semibold text-ink-700 mb-1.5">
              {t("visits.assignDate")} <span className="text-brand-500">*</span>
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
                {activeTemplates.map((tmpl) => (
                  <option key={tmpl.id} value={tmpl.id}>
                    {tmpl.name_ar} / {tmpl.name_en}
                  </option>
                ))}
              </select>
            </div>
            {activeTemplates.length === 0 && (
              <p className="mt-1 text-[11px] text-ink-400">
                {t("visits.noActiveTemplates")}
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
              disabled={create.isPending}
              className="flex-1 h-11 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white text-[13.5px] font-semibold shadow-pop transition-all"
            >
              {create.isPending ? t("common.loading") : t("common.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
