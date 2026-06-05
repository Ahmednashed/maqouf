"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  X, MapPin, Hash, Link2, Navigation,
  Home, Globe, Map, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/hooks/use-translation";
import { useCreatePlace, useUpdatePlace } from "@/hooks/use-places";
import { useChains } from "@/hooks/use-chains";
import type { PlaceWithChain } from "@/services/places";

// ─── Zod schema ───────────────────────────────────────────────────────────────
// lat/lng are kept as strings in the form, parsed to numbers in onSubmit.
const placeSchema = z.object({
  chain_id:   z.string().min(1, "يجب اختيار السلسلة"),
  branch_ar:  z.string().min(2, "الاسم العربي مطلوب (حرفان على الأقل)"),
  branch_en:  z.string().min(2, "English name is required (min 2 chars)"),
  code: z
    .string()
    .min(2, "الكود مطلوب")
    .max(15, "الكود لا يتجاوز 15 حرفاً")
    .regex(/^[A-Z0-9_-]+$/, "أحرف كبيرة، أرقام، - أو _ فقط"),
  address_ar:  z.string().optional(),
  address_en:  z.string().optional(),
  city_ar:     z.string().optional(),
  city_en:     z.string().optional(),
  region:      z.string().optional(),
  lat: z.string()
    .optional()
    .refine(
      (v) => !v || !isNaN(parseFloat(v)),
      "يجب أن يكون رقماً"
    )
    .refine(
      (v) => !v || (parseFloat(v) >= -90 && parseFloat(v) <= 90),
      "بين ‑90 و 90"
    ),
  lng: z.string()
    .optional()
    .refine(
      (v) => !v || !isNaN(parseFloat(v)),
      "يجب أن يكون رقماً"
    )
    .refine(
      (v) => !v || (parseFloat(v) >= -180 && parseFloat(v) <= 180),
      "بين ‑180 و 180"
    ),
  is_active: z.boolean().default(true),
});

type PlaceFormData = z.infer<typeof placeSchema>;

// ─── Props ────────────────────────────────────────────────────────────────────
interface PlaceModalProps {
  place?: PlaceWithChain | null;
  onClose: () => void;
}

// ─── Section header helper ────────────────────────────────────────────────────
function SectionHeader({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex items-center gap-2 pb-1 border-b border-ink-100 mb-3 mt-5 first:mt-0">
      <Icon className="w-3.5 h-3.5 text-brand-500" />
      <span className="text-[11.5px] font-bold text-ink-500 uppercase tracking-wider">
        {label}
      </span>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
export function PlaceModal({ place, onClose }: PlaceModalProps) {
  const { t } = useTranslation();
  const isEdit    = Boolean(place);
  const create    = useCreatePlace();
  const update    = useUpdatePlace();
  const isPending = create.isPending || update.isPending;

  // Chains dropdown data
  const { data: chains = [], isLoading: chainsLoading } = useChains();
  const activeChains = chains.filter((c) => c.is_active);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<PlaceFormData>({
    resolver: zodResolver(placeSchema),
    defaultValues: {
      chain_id:   place?.chain_id  ?? "",
      branch_ar:  place?.branch_ar ?? "",
      branch_en:  place?.branch_en ?? "",
      code:       place?.code      ?? "",
      address_ar: place?.address_ar ?? "",
      address_en: place?.address_en ?? "",
      city_ar:    place?.city_ar   ?? "",
      city_en:    place?.city_en   ?? "",
      region:     place?.region    ?? "",
      lat:        place?.lat != null ? String(place.lat) : "",
      lng:        place?.lng != null ? String(place.lng) : "",
      is_active:  place?.is_active ?? true,
    },
  });

  const isActive = watch("is_active");

  // Re-populate form when switching between rows to edit.
  useEffect(() => {
    reset({
      chain_id:   place?.chain_id  ?? "",
      branch_ar:  place?.branch_ar ?? "",
      branch_en:  place?.branch_en ?? "",
      code:       place?.code      ?? "",
      address_ar: place?.address_ar ?? "",
      address_en: place?.address_en ?? "",
      city_ar:    place?.city_ar   ?? "",
      city_en:    place?.city_en   ?? "",
      region:     place?.region    ?? "",
      lat:        place?.lat != null ? String(place.lat) : "",
      lng:        place?.lng != null ? String(place.lng) : "",
      is_active:  place?.is_active ?? true,
    });
  }, [place, reset]);

  // ── Submit ──────────────────────────────────────────────────────────────────
  async function onSubmit(data: PlaceFormData) {
    // Parse coordinate strings → numbers (or null if empty).
    const payload = {
      ...data,
      lat: data.lat && data.lat.trim() !== "" ? parseFloat(data.lat) : null,
      lng: data.lng && data.lng.trim() !== "" ? parseFloat(data.lng) : null,
      // Strip empty optional strings to avoid storing "" in the DB.
      address_ar: data.address_ar?.trim() || undefined,
      address_en: data.address_en?.trim() || undefined,
      city_ar:    data.city_ar?.trim()    || undefined,
      city_en:    data.city_en?.trim()    || undefined,
      region:     data.region?.trim()     || undefined,
    };

    if (isEdit && place) {
      await update.mutateAsync({ id: place.id, payload });
    } else {
      await create.mutateAsync(payload);
    }
    onClose();
  }

  // ── Shared input class ──────────────────────────────────────────────────────
  const inputCls = (hasError?: boolean) =>
    cn(
      "w-full h-10 ps-9 pe-3 rounded-xl border bg-white text-[13px] outline-none transition-all",
      "placeholder:text-ink-300",
      "focus:border-brand-500 focus:ring-2 focus:ring-brand-50",
      hasError ? "border-rose-400 bg-rose-50/30" : "border-ink-200"
    );

  const inputNoIconCls = (hasError?: boolean) =>
    cn(
      "w-full h-10 px-3 rounded-xl border bg-white text-[13px] outline-none transition-all",
      "placeholder:text-ink-300",
      "focus:border-brand-500 focus:ring-2 focus:ring-brand-50",
      hasError ? "border-rose-400 bg-rose-50/30" : "border-ink-200"
    );

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm animate-fade-in" />

      {/* Panel — wider to fit 2-column grid, scrollable */}
      <div
        className="relative w-full max-w-2xl bg-white rounded-2xl shadow-modal border border-ink-100 animate-slide-up flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Sticky header ──────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-ink-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center">
              <MapPin className="w-4 h-4 text-brand-500" />
            </div>
            <h2 className="text-[16px] font-bold text-ink-900">
              {isEdit ? t("places.edit") : t("places.add")}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-400 hover:text-ink-700 hover:bg-ink-100 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Scrollable body ────────────────────────────────────────────── */}
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="overflow-y-auto px-6 py-5 space-y-0 flex-1"
        >
          {/* ── SECTION 1: Identity ──────────────────────────────────────── */}
          <SectionHeader icon={MapPin} label={t("places.sectionIdentity")} />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            {/* Arabic Name */}
            <div>
              <label className="block text-[12px] font-semibold text-ink-700 mb-1">
                {t("places.branchAr")} <span className="text-brand-500">*</span>
              </label>
              <div className="relative">
                <MapPin className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none" />
                <input
                  {...register("branch_ar")}
                  dir="rtl"
                  placeholder="مثال: فرع الرياض — العليا"
                  className={inputCls(!!errors.branch_ar)}
                />
              </div>
              {errors.branch_ar && (
                <p className="mt-0.5 text-[11px] text-rose-500">{errors.branch_ar.message}</p>
              )}
            </div>

            {/* English Name */}
            <div>
              <label className="block text-[12px] font-semibold text-ink-700 mb-1">
                {t("places.branchEn")} <span className="text-brand-500">*</span>
              </label>
              <div className="relative">
                <Globe className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none" />
                <input
                  {...register("branch_en")}
                  dir="ltr"
                  placeholder="e.g. Riyadh — Olaya Branch"
                  className={inputCls(!!errors.branch_en)}
                />
              </div>
              {errors.branch_en && (
                <p className="mt-0.5 text-[11px] text-rose-500">{errors.branch_en.message}</p>
              )}
            </div>

            {/* Code */}
            <div>
              <label className="block text-[12px] font-semibold text-ink-700 mb-1">
                {t("places.code")} <span className="text-brand-500">*</span>
              </label>
              <div className="relative">
                <Hash className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none" />
                <input
                  {...register("code")}
                  dir="ltr"
                  placeholder="LULU-01"
                  maxLength={15}
                  className={inputCls(!!errors.code)}
                  onChange={(e) =>
                    setValue("code", e.target.value.toUpperCase(), {
                      shouldValidate: true,
                    })
                  }
                />
              </div>
              <p className="mt-0.5 text-[10.5px] text-ink-400">{t("places.codeHint")}</p>
              {errors.code && (
                <p className="mt-0 text-[11px] text-rose-500">{errors.code.message}</p>
              )}
            </div>

            {/* Chain dropdown */}
            <div>
              <label className="block text-[12px] font-semibold text-ink-700 mb-1">
                {t("places.chain")} <span className="text-brand-500">*</span>
              </label>
              <div className="relative">
                <Link2 className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none z-10" />
                <ChevronDown className="absolute end-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none z-10" />
                <select
                  {...register("chain_id")}
                  disabled={chainsLoading}
                  className={cn(
                    "w-full h-10 ps-9 pe-8 rounded-xl border bg-white text-[13px] outline-none transition-all appearance-none cursor-pointer",
                    "focus:border-brand-500 focus:ring-2 focus:ring-brand-50",
                    errors.chain_id
                      ? "border-rose-400 bg-rose-50/30"
                      : "border-ink-200",
                    chainsLoading && "opacity-60"
                  )}
                >
                  <option value="">
                    {chainsLoading ? t("common.loading") : t("places.chainPlaceholder")}
                  </option>
                  {activeChains.length === 0 && !chainsLoading && (
                    <option value="" disabled>{t("places.noChains")}</option>
                  )}
                  {activeChains.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name_ar} ({c.code})
                    </option>
                  ))}
                </select>
              </div>
              {errors.chain_id && (
                <p className="mt-0.5 text-[11px] text-rose-500">{errors.chain_id.message}</p>
              )}
            </div>
          </div>

          {/* ── SECTION 2: Address ───────────────────────────────────────── */}
          <SectionHeader icon={Home} label={t("places.sectionAddress")} />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            {/* Arabic Address */}
            <div>
              <label className="block text-[12px] font-semibold text-ink-700 mb-1">
                {t("places.addressAr")}
                <span className="ms-1 text-[10.5px] font-normal text-ink-400">({t("common.optional")})</span>
              </label>
              <input
                {...register("address_ar")}
                dir="rtl"
                placeholder="مثال: طريق الملك فهد"
                className={inputNoIconCls(!!errors.address_ar)}
              />
            </div>

            {/* English Address */}
            <div>
              <label className="block text-[12px] font-semibold text-ink-700 mb-1">
                {t("places.addressEn")}
                <span className="ms-1 text-[10.5px] font-normal text-ink-400">({t("common.optional")})</span>
              </label>
              <input
                {...register("address_en")}
                dir="ltr"
                placeholder="e.g. King Fahad Road"
                className={inputNoIconCls(!!errors.address_en)}
              />
            </div>

            {/* Arabic City */}
            <div>
              <label className="block text-[12px] font-semibold text-ink-700 mb-1">
                {t("places.cityAr")}
                <span className="ms-1 text-[10.5px] font-normal text-ink-400">({t("common.optional")})</span>
              </label>
              <input
                {...register("city_ar")}
                dir="rtl"
                placeholder="مثال: الرياض"
                className={inputNoIconCls()}
              />
            </div>

            {/* English City */}
            <div>
              <label className="block text-[12px] font-semibold text-ink-700 mb-1">
                {t("places.cityEn")}
                <span className="ms-1 text-[10.5px] font-normal text-ink-400">({t("common.optional")})</span>
              </label>
              <input
                {...register("city_en")}
                dir="ltr"
                placeholder="e.g. Riyadh"
                className={inputNoIconCls()}
              />
            </div>

            {/* Region — spans full width */}
            <div className="sm:col-span-2">
              <label className="block text-[12px] font-semibold text-ink-700 mb-1">
                {t("places.region")}
                <span className="ms-1 text-[10.5px] font-normal text-ink-400">({t("common.optional")})</span>
              </label>
              <div className="relative">
                <Map className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none" />
                <input
                  {...register("region")}
                  placeholder="مثال: المنطقة الوسطى / Central Region"
                  className={inputCls()}
                />
              </div>
            </div>
          </div>

          {/* ── SECTION 3: Coordinates ───────────────────────────────────── */}
          <SectionHeader icon={Navigation} label={t("places.sectionCoords")} />

          <div className="grid grid-cols-2 gap-3 mb-3">
            {/* Latitude */}
            <div>
              <label className="block text-[12px] font-semibold text-ink-700 mb-1">
                {t("places.lat")}
                <span className="ms-1 text-[10.5px] font-normal text-ink-400">({t("places.latHint")})</span>
              </label>
              <div className="relative">
                <Navigation className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none" />
                <input
                  {...register("lat")}
                  dir="ltr"
                  type="text"
                  inputMode="decimal"
                  placeholder="24.7136"
                  className={inputCls(!!errors.lat)}
                />
              </div>
              {errors.lat && (
                <p className="mt-0.5 text-[11px] text-rose-500">{errors.lat.message}</p>
              )}
            </div>

            {/* Longitude */}
            <div>
              <label className="block text-[12px] font-semibold text-ink-700 mb-1">
                {t("places.lng")}
                <span className="ms-1 text-[10.5px] font-normal text-ink-400">({t("places.lngHint")})</span>
              </label>
              <div className="relative">
                <Navigation className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none rotate-90" />
                <input
                  {...register("lng")}
                  dir="ltr"
                  type="text"
                  inputMode="decimal"
                  placeholder="46.6753"
                  className={inputCls(!!errors.lng)}
                />
              </div>
              {errors.lng && (
                <p className="mt-0.5 text-[11px] text-rose-500">{errors.lng.message}</p>
              )}
            </div>
          </div>

          {/* ── Status toggle ────────────────────────────────────────────── */}
          <div className="flex items-center justify-between py-2.5 px-3 rounded-xl bg-ink-50 border border-ink-100 mt-4">
            <span className="text-[13px] font-medium text-ink-700">{t("common.status")}</span>
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
        </form>

        {/* ── Sticky footer ──────────────────────────────────────────────── */}
        <div className="flex gap-3 px-6 py-4 border-t border-ink-100 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 h-11 rounded-xl border border-ink-200 text-ink-700 text-[13.5px] font-semibold hover:bg-ink-50 transition-all"
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            form={undefined}
            disabled={isPending}
            onClick={handleSubmit(onSubmit)}
            className="flex-1 h-11 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white text-[13.5px] font-semibold shadow-pop transition-all"
          >
            {isPending ? t("common.loading") : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
