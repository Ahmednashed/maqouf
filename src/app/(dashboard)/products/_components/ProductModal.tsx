"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  X, Package, Hash, Tag, Ruler,
  DollarSign, BarChart2, Image as ImageIcon, ChevronDown,
  Globe,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/hooks/use-translation";
import { useCreateProduct, useUpdateProduct } from "@/hooks/use-products";
import type { Product, ProductCategory, ProductUnit } from "@/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORIES: ProductCategory[] = [
  "beverages", "snacks", "dairy", "bakery", "frozen",
];

const UNITS: ProductUnit[] = [
  "piece", "box", "carton", "kg", "liter",
];

// ─── Zod schema ───────────────────────────────────────────────────────────────
// cost / price / stock are kept as strings in the form, parsed to numbers on submit.
const productSchema = z.object({
  name_ar:   z.string().min(2, "الاسم العربي مطلوب (حرفان على الأقل)"),
  name_en:   z.string().min(2, "English name is required (min 2 chars)"),
  sku: z
    .string()
    .min(1, "الـ SKU مطلوب")
    .max(30, "الـ SKU لا يتجاوز 30 حرفاً")
    .regex(/^[A-Z0-9_-]+$/, "أحرف كبيرة، أرقام، - أو _ فقط"),
  category: z.enum(
    ["beverages", "snacks", "dairy", "bakery", "frozen"],
    { errorMap: () => ({ message: "يجب اختيار الفئة" }) }
  ),
  unit: z.enum(
    ["piece", "box", "carton", "kg", "liter"],
    { errorMap: () => ({ message: "يجب اختيار الوحدة" }) }
  ),
  cost: z
    .string()
    .optional()
    .refine((v) => !v || !isNaN(parseFloat(v)),  "يجب أن يكون رقماً")
    .refine((v) => !v || parseFloat(v) >= 0,     "لا يمكن أن يكون سالباً"),
  price: z
    .string()
    .optional()
    .refine((v) => !v || !isNaN(parseFloat(v)),  "يجب أن يكون رقماً")
    .refine((v) => !v || parseFloat(v) >= 0,     "لا يمكن أن يكون سالباً"),
  stock: z
    .string()
    .optional()
    .refine((v) => !v || !isNaN(parseInt(v, 10)), "يجب أن يكون رقماً صحيحاً")
    .refine((v) => !v || parseInt(v, 10) >= 0,   "لا يمكن أن يكون سالباً"),
  image_url: z.string().url("رابط URL غير صالح").optional().or(z.literal("")),
  is_active: z.boolean().default(true),
});

type ProductFormData = z.infer<typeof productSchema>;

// ─── Props ────────────────────────────────────────────────────────────────────
interface ProductModalProps {
  product?: Product | null;
  onClose:  () => void;
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
export function ProductModal({ product, onClose }: ProductModalProps) {
  const { t } = useTranslation();
  const isEdit    = Boolean(product);
  const create    = useCreateProduct();
  const update    = useUpdateProduct();
  const isPending = create.isPending || update.isPending;

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<ProductFormData>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name_ar:   product?.name_ar   ?? "",
      name_en:   product?.name_en   ?? "",
      sku:       product?.sku       ?? "",
      category:  product?.category  ?? undefined,
      unit:      product?.unit      ?? undefined,
      cost:      product?.cost  != null ? String(product.cost)  : "",
      price:     product?.price != null ? String(product.price) : "",
      stock:     product?.stock != null ? String(product.stock) : "0",
      image_url: product?.image_url ?? "",
      is_active: product?.is_active ?? true,
    },
  });

  const isActive   = watch("is_active");
  const imageUrl   = watch("image_url");

  // Re-populate form when switching rows to edit.
  useEffect(() => {
    reset({
      name_ar:   product?.name_ar   ?? "",
      name_en:   product?.name_en   ?? "",
      sku:       product?.sku       ?? "",
      category:  product?.category  ?? undefined,
      unit:      product?.unit      ?? undefined,
      cost:      product?.cost  != null ? String(product.cost)  : "",
      price:     product?.price != null ? String(product.price) : "",
      stock:     product?.stock != null ? String(product.stock) : "0",
      image_url: product?.image_url ?? "",
      is_active: product?.is_active ?? true,
    });
  }, [product, reset]);

  // ── Submit ──────────────────────────────────────────────────────────────────
  async function onSubmit(data: ProductFormData) {
    const parseNum = (v?: string) =>
      v && v.trim() !== "" ? parseFloat(v) : null;
    const parseIntSafe = (v?: string) =>
      v && v.trim() !== "" ? parseInt(v, 10) : 0;

    const payload = {
      name_ar:   data.name_ar,
      name_en:   data.name_en,
      sku:       data.sku,
      category:  data.category,
      unit:      data.unit,
      cost:      parseNum(data.cost),
      price:     parseNum(data.price),
      stock:     parseIntSafe(data.stock),
      image_url: data.image_url?.trim() || undefined,
      is_active: data.is_active,
    };

    if (isEdit && product) {
      await update.mutateAsync({ id: product.id, payload });
    } else {
      await create.mutateAsync(payload);
    }
    onClose();
  }

  // ── Shared input classes ─────────────────────────────────────────────────────
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

  const selectCls = (hasError?: boolean) =>
    cn(
      "w-full h-10 ps-9 pe-8 rounded-xl border bg-white text-[13px] outline-none transition-all appearance-none cursor-pointer",
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

      {/* Panel — wide, scrollable */}
      <div
        className="relative w-full max-w-2xl bg-white rounded-2xl shadow-modal border border-ink-100 animate-slide-up flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Sticky header ────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-ink-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center">
              <Package className="w-4 h-4 text-brand-500" />
            </div>
            <h2 className="text-[16px] font-bold text-ink-900">
              {isEdit ? t("products.edit") : t("products.add")}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-400 hover:text-ink-700 hover:bg-ink-100 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Scrollable body ──────────────────────────────────────────────── */}
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="overflow-y-auto px-6 py-5 flex-1"
        >
          {/* ── SECTION 1: Identity ────────────────────────────────────────── */}
          <SectionHeader icon={Package} label={t("products.sectionIdentity")} />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            {/* Arabic Name */}
            <div>
              <label className="block text-[12px] font-semibold text-ink-700 mb-1">
                {t("products.nameAr")} <span className="text-brand-500">*</span>
              </label>
              <div className="relative">
                <Package className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none" />
                <input
                  {...register("name_ar")}
                  dir="rtl"
                  placeholder="مثال: عصير البرتقال"
                  className={inputCls(!!errors.name_ar)}
                />
              </div>
              {errors.name_ar && (
                <p className="mt-0.5 text-[11px] text-rose-500">{errors.name_ar.message}</p>
              )}
            </div>

            {/* English Name */}
            <div>
              <label className="block text-[12px] font-semibold text-ink-700 mb-1">
                {t("products.nameEn")} <span className="text-brand-500">*</span>
              </label>
              <div className="relative">
                <Globe className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none" />
                <input
                  {...register("name_en")}
                  dir="ltr"
                  placeholder="e.g. Orange Juice"
                  className={inputCls(!!errors.name_en)}
                />
              </div>
              {errors.name_en && (
                <p className="mt-0.5 text-[11px] text-rose-500">{errors.name_en.message}</p>
              )}
            </div>

            {/* SKU */}
            <div>
              <label className="block text-[12px] font-semibold text-ink-700 mb-1">
                {t("products.sku")} <span className="text-brand-500">*</span>
              </label>
              <div className="relative">
                <Hash className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none" />
                <input
                  {...register("sku")}
                  dir="ltr"
                  placeholder="JUICE-OJ-1L"
                  maxLength={30}
                  className={inputCls(!!errors.sku)}
                  onChange={(e) =>
                    setValue("sku", e.target.value.toUpperCase(), {
                      shouldValidate: true,
                    })
                  }
                />
              </div>
              <p className="mt-0.5 text-[10.5px] text-ink-400">{t("products.skuHint")}</p>
              {errors.sku && (
                <p className="mt-0 text-[11px] text-rose-500">{errors.sku.message}</p>
              )}
            </div>

            {/* Category */}
            <div>
              <label className="block text-[12px] font-semibold text-ink-700 mb-1">
                {t("products.category")} <span className="text-brand-500">*</span>
              </label>
              <div className="relative">
                <Tag className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none z-10" />
                <ChevronDown className="absolute end-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none z-10" />
                <select
                  {...register("category")}
                  className={selectCls(!!errors.category)}
                >
                  <option value="">{t("products.categoryPlaceholder")}</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t(`products.cat.${c}` as Parameters<typeof t>[0])}
                    </option>
                  ))}
                </select>
              </div>
              {errors.category && (
                <p className="mt-0.5 text-[11px] text-rose-500">{errors.category.message}</p>
              )}
            </div>

            {/* Unit */}
            <div className="sm:col-span-2">
              <label className="block text-[12px] font-semibold text-ink-700 mb-1">
                {t("products.unit")} <span className="text-brand-500">*</span>
              </label>
              <div className="relative max-w-xs">
                <Ruler className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none z-10" />
                <ChevronDown className="absolute end-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none z-10" />
                <select
                  {...register("unit")}
                  className={selectCls(!!errors.unit)}
                >
                  <option value="">{t("products.unitPlaceholder")}</option>
                  {UNITS.map((u) => (
                    <option key={u} value={u}>
                      {t(`products.unit.${u}` as Parameters<typeof t>[0])}
                    </option>
                  ))}
                </select>
              </div>
              {errors.unit && (
                <p className="mt-0.5 text-[11px] text-rose-500">{errors.unit.message}</p>
              )}
            </div>
          </div>

          {/* ── SECTION 2: Pricing & Stock ────────────────────────────────── */}
          <SectionHeader icon={DollarSign} label={t("products.sectionPricing")} />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
            {/* Cost Price */}
            <div>
              <label className="block text-[12px] font-semibold text-ink-700 mb-1">
                {t("products.costPrice")}
                <span className="ms-1 text-[10.5px] font-normal text-ink-400">({t("common.optional")})</span>
              </label>
              <div className="relative">
                <DollarSign className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none" />
                <input
                  {...register("cost")}
                  dir="ltr"
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  className={inputCls(!!errors.cost)}
                />
              </div>
              {errors.cost && (
                <p className="mt-0.5 text-[11px] text-rose-500">{errors.cost.message}</p>
              )}
            </div>

            {/* Selling Price */}
            <div>
              <label className="block text-[12px] font-semibold text-ink-700 mb-1">
                {t("products.sellingPrice")}
                <span className="ms-1 text-[10.5px] font-normal text-ink-400">({t("common.optional")})</span>
              </label>
              <div className="relative">
                <DollarSign className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none" />
                <input
                  {...register("price")}
                  dir="ltr"
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  className={inputCls(!!errors.price)}
                />
              </div>
              {errors.price && (
                <p className="mt-0.5 text-[11px] text-rose-500">{errors.price.message}</p>
              )}
            </div>

            {/* Stock */}
            <div>
              <label className="block text-[12px] font-semibold text-ink-700 mb-1">
                {t("products.stock")}
              </label>
              <div className="relative">
                <BarChart2 className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none" />
                <input
                  {...register("stock")}
                  dir="ltr"
                  type="text"
                  inputMode="numeric"
                  placeholder="0"
                  className={inputCls(!!errors.stock)}
                />
              </div>
              {errors.stock && (
                <p className="mt-0.5 text-[11px] text-rose-500">{errors.stock.message}</p>
              )}
            </div>
          </div>

          {/* ── SECTION 3: Media ──────────────────────────────────────────── */}
          <SectionHeader icon={ImageIcon} label={t("products.sectionMedia")} />

          <div className="mb-3">
            <label className="block text-[12px] font-semibold text-ink-700 mb-1">
              {t("products.imageUrl")}
              <span className="ms-1 text-[10.5px] font-normal text-ink-400">({t("common.optional")})</span>
            </label>
            <div className="flex gap-3 items-start">
              {/* Image preview */}
              <div className="w-14 h-14 rounded-xl border border-ink-200 bg-ink-50 flex items-center justify-center overflow-hidden shrink-0">
                {imageUrl && imageUrl.trim() !== "" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imageUrl}
                    alt="preview"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : (
                  <ImageIcon className="w-6 h-6 text-ink-300" />
                )}
              </div>
              <div className="flex-1">
                <div className="relative">
                  <ImageIcon className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none" />
                  <input
                    {...register("image_url")}
                    dir="ltr"
                    type="url"
                    placeholder="https://example.com/image.jpg"
                    className={inputCls(!!errors.image_url)}
                  />
                </div>
                <p className="mt-0.5 text-[10.5px] text-ink-400">{t("products.imageUrlHint")}</p>
                {errors.image_url && (
                  <p className="mt-0 text-[11px] text-rose-500">{errors.image_url.message}</p>
                )}
              </div>
            </div>
          </div>

          {/* ── Status toggle ─────────────────────────────────────────────── */}
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

        {/* ── Sticky footer ────────────────────────────────────────────────── */}
        <div className="flex gap-3 px-6 py-4 border-t border-ink-100 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 h-11 rounded-xl border border-ink-200 text-ink-700 text-[13.5px] font-semibold hover:bg-ink-50 transition-all"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
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
