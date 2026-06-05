"use client";

import { useEffect, useState, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  X, Package, Search, BarChart2,
  ShieldCheck, SortAsc, AlertCircle,
} from "lucide-react";
import type { UseFormRegister, UseFormSetValue, UseFormWatch, FieldErrors } from "react-hook-form";
import { cn } from "@/lib/utils/cn";
import { useTranslation, type TranslationFn } from "@/hooks/use-translation";
import { useAssignPlaceProduct, useUpdatePlaceProduct } from "@/hooks/use-place-products";
import { useProducts } from "@/hooks/use-products";
import type { PlaceProductWithProduct } from "@/services/place-products";
import type { Product } from "@/types";

// ─── Zod schema ───────────────────────────────────────────────────────────────
const assignSchema = z.object({
  product_id: z.string().min(1, "يجب اختيار المنتج"),
  is_mandatory:     z.boolean().default(false),
  min_stock: z
    .string()
    .optional()
    .refine((v) => !v || !isNaN(parseInt(v, 10)), "يجب أن يكون رقماً صحيحاً")
    .refine((v) => !v || parseInt(v, 10) >= 0,   "لا يمكن أن يكون سالباً"),
  display_priority: z
    .string()
    .optional()
    .refine((v) => !v || !isNaN(parseInt(v, 10)), "يجب أن يكون رقماً صحيحاً")
    .refine((v) => !v || parseInt(v, 10) >= 0,   "لا يمكن أن يكون سالباً"),
  is_active: z.boolean().default(true),
});

const editSchema = assignSchema.omit({ product_id: true });

type AssignFormData = z.infer<typeof assignSchema>;
type EditFormData   = z.infer<typeof editSchema>;

/**
 * The field subset that SettingsFields reads and writes.
 * It is the intersection of AssignFormData and EditFormData —
 * derived via Pick so it stays in sync with the schema.
 */
type SettingsFormValues = Pick<
  AssignFormData,
  "is_mandatory" | "is_active" | "min_stock" | "display_priority"
>;

// ─── Props ────────────────────────────────────────────────────────────────────
interface AssignProps {
  mode:             "assign";
  placeId:          string;
  assignedProducts: PlaceProductWithProduct[];
  onClose:          () => void;
}

interface EditProps {
  mode:             "edit";
  placeId:          string;
  placeProduct:     PlaceProductWithProduct;
  onClose:          () => void;
}

type PlaceProductModalProps = AssignProps | EditProps;

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

// ─── Shared settings fields ───────────────────────────────────────────────────
interface SettingsFieldsProps {
  register: UseFormRegister<SettingsFormValues>;
  setValue: UseFormSetValue<SettingsFormValues>;
  watch:    UseFormWatch<SettingsFormValues>;
  errors:   FieldErrors<SettingsFormValues>;
  t:        TranslationFn;
}

function SettingsFields({ register, setValue, watch, errors, t }: SettingsFieldsProps) {
  const isActive    = watch("is_active")    as boolean;
  const isMandatory = watch("is_mandatory") as boolean;

  return (
    <>
      {/* is_mandatory + is_active toggles */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        {/* Mandatory toggle */}
        <div className="flex items-center justify-between py-2.5 px-3 rounded-xl bg-ink-50 border border-ink-100">
          <div>
            <p className="text-[12.5px] font-semibold text-ink-700">
              {t("placeProducts.isMandatory")}
            </p>
            <p className="text-[10.5px] text-ink-400 leading-tight">
              {t("placeProducts.isMandatoryHint")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setValue("is_mandatory", !isMandatory)}
            className={cn(
              "relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ms-2",
              isMandatory ? "bg-amber-500" : "bg-ink-200"
            )}
          >
            <span
              className={cn(
                "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
                isMandatory ? "translate-x-6" : "translate-x-1"
              )}
            />
          </button>
        </div>

        {/* Active toggle */}
        <div className="flex items-center justify-between py-2.5 px-3 rounded-xl bg-ink-50 border border-ink-100">
          <div>
            <p className="text-[12.5px] font-semibold text-ink-700">
              {t("common.status")}
            </p>
            <p className="text-[10.5px] text-ink-400 leading-tight">
              {t("common.active")} / {t("common.inactive")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setValue("is_active", !isActive)}
            className={cn(
              "relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ms-2",
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
      </div>

      {/* Min stock + Priority */}
      <div className="grid grid-cols-2 gap-3">
        {/* Min Stock */}
        <div>
          <label className="block text-[12px] font-semibold text-ink-700 mb-1">
            {t("placeProducts.minStock")}
            <span className="ms-1 text-[10.5px] font-normal text-ink-400">
              ({t("common.optional")})
            </span>
          </label>
          <div className="relative">
            <BarChart2 className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none" />
            <input
              {...register("min_stock")}
              dir="ltr"
              type="text"
              inputMode="numeric"
              placeholder="0"
              className={cn(
                "w-full h-10 ps-9 pe-3 rounded-xl border bg-white text-[13px] outline-none transition-all",
                "placeholder:text-ink-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-50",
                errors.min_stock ? "border-rose-400 bg-rose-50/30" : "border-ink-200"
              )}
            />
          </div>
          <p className="mt-0.5 text-[10.5px] text-ink-400">
            {t("placeProducts.minStockHint")}
          </p>
          {errors.min_stock && (
            <p className="mt-0 text-[11px] text-rose-500">
              {String((errors.min_stock as { message?: string })?.message ?? "")}
            </p>
          )}
        </div>

        {/* Display Priority */}
        <div>
          <label className="block text-[12px] font-semibold text-ink-700 mb-1">
            {t("placeProducts.displayPriority")}
            <span className="ms-1 text-[10.5px] font-normal text-ink-400">
              ({t("common.optional")})
            </span>
          </label>
          <div className="relative">
            <SortAsc className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none" />
            <input
              {...register("display_priority")}
              dir="ltr"
              type="text"
              inputMode="numeric"
              placeholder="0"
              className={cn(
                "w-full h-10 ps-9 pe-3 rounded-xl border bg-white text-[13px] outline-none transition-all",
                "placeholder:text-ink-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-50",
                errors.display_priority ? "border-rose-400 bg-rose-50/30" : "border-ink-200"
              )}
            />
          </div>
          <p className="mt-0.5 text-[10.5px] text-ink-400">
            {t("placeProducts.displayPriorityHint")}
          </p>
          {errors.display_priority && (
            <p className="mt-0 text-[11px] text-rose-500">
              {String((errors.display_priority as { message?: string })?.message ?? "")}
            </p>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Assign Mode (create) ─────────────────────────────────────────────────────
function AssignMode({ placeId, assignedProducts, onClose }: Omit<AssignProps, "mode">) {
  const { t, locale } = useTranslation();
  const assign        = useAssignPlaceProduct();
  const { data: allProducts = [] } = useProducts();

  const [productSearch, setProductSearch] = useState("");

  // Products not yet in this branch
  const assignedIds = useMemo(
    () => new Set(assignedProducts.map((pp) => pp.product_id)),
    [assignedProducts]
  );

  const availableProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    return allProducts
      .filter((p) => p.is_active && !assignedIds.has(p.id))
      .filter(
        (p) =>
          !q ||
          p.name_ar.toLowerCase().includes(q) ||
          p.name_en.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q)
      );
  }, [allProducts, assignedIds, productSearch]);

  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  const {
    register, handleSubmit, setValue, watch,
    formState: { errors },
  } = useForm<AssignFormData>({
    resolver:      zodResolver(assignSchema),
    defaultValues: { product_id: "", is_mandatory: false, min_stock: "0", display_priority: "0", is_active: true },
  });

  async function onSubmit(data: AssignFormData) {
    await assign.mutateAsync({
      place_id:         placeId,
      product_id:       data.product_id,
      is_mandatory:     data.is_mandatory,
      min_stock:        parseInt(data.min_stock   ?? "0", 10),
      display_priority: parseInt(data.display_priority ?? "0", 10),
      is_active:        data.is_active,
    });
    onClose();
  }

  function selectProduct(p: Product) {
    setSelectedProduct(p);
    setValue("product_id", p.id, { shouldValidate: true });
    setProductSearch("");
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm animate-fade-in" />
      <div
        className="relative w-full max-w-lg bg-white rounded-2xl shadow-modal border border-ink-100 animate-slide-up flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-ink-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center">
              <Package className="w-4 h-4 text-brand-500" />
            </div>
            <h2 className="text-[16px] font-bold text-ink-900">
              {t("placeProducts.assign")}
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
        <form onSubmit={handleSubmit(onSubmit)} className="overflow-y-auto px-6 py-5 flex-1">
          {/* ── Product selection ──────────────────────────────────────── */}
          <SectionHeader icon={Package} label={t("placeProducts.sectionProduct")} />

          {selectedProduct ? (
            // Selected product card
            <div className="flex items-center gap-3 p-3 rounded-xl border border-brand-200 bg-brand-50 mb-3">
              <div className="w-10 h-10 rounded-xl border border-ink-100 bg-white flex items-center justify-center overflow-hidden shrink-0">
                {selectedProduct.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={selectedProduct.image_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <Package className="w-4 h-4 text-ink-300" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-ink-800 text-[13px] leading-tight truncate">
                  {locale === "ar" ? selectedProduct.name_ar : selectedProduct.name_en}
                </p>
                <p className="text-[11px] text-ink-400">
                  {selectedProduct.sku}
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setSelectedProduct(null); setValue("product_id", ""); }}
                className="w-6 h-6 rounded-md flex items-center justify-center text-ink-400 hover:text-rose-500 hover:bg-rose-50 transition-all shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            // Search + list
            <div className="mb-3">
              <div className="relative mb-2">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none" />
                <input
                  type="text"
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  placeholder={t("placeProducts.productSearch")}
                  className="w-full h-9 ps-9 pe-3 rounded-xl border border-ink-200 bg-ink-50 text-[13px] outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-100 transition-all"
                />
              </div>

              {/* Product list */}
              <div className="max-h-44 overflow-y-auto rounded-xl border border-ink-100 divide-y divide-ink-50">
                {availableProducts.length === 0 ? (
                  <div className="py-6 text-center">
                    <AlertCircle className="w-5 h-5 text-ink-300 mx-auto mb-1" />
                    <p className="text-[12px] text-ink-400">
                      {assignedIds.size === allProducts.filter((p) => p.is_active).length
                        ? t("placeProducts.noAvailable")
                        : t("placeProducts.noResults")}
                    </p>
                  </div>
                ) : (
                  availableProducts.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => selectProduct(p)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-brand-50 transition-colors text-start"
                    >
                      <div className="w-8 h-8 rounded-lg border border-ink-100 bg-ink-50 flex items-center justify-center overflow-hidden shrink-0">
                        {p.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.image_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <Package className="w-3.5 h-3.5 text-ink-300" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-ink-800 leading-tight truncate">
                          {locale === "ar" ? p.name_ar : p.name_en}
                        </p>
                        <p className="text-[11px] text-ink-400">{p.sku}</p>
                      </div>
                    </button>
                  ))
                )}
              </div>
              {errors.product_id && (
                <p className="mt-1 text-[11px] text-rose-500">{errors.product_id.message}</p>
              )}
            </div>
          )}

          {/* ── Settings ────────────────────────────────────────────────── */}
          <SectionHeader icon={ShieldCheck} label={t("placeProducts.sectionSettings")} />
          <SettingsFields
            // AssignFormData is a superset of SettingsFormValues (adds product_id).
            // SettingsFields only accesses the shared fields, so this is safe.
            // The double-cast through `unknown` is required because react-hook-form's
            // generic types are invariant and TypeScript cannot prove the overlap.
            register={register as unknown as UseFormRegister<SettingsFormValues>}
            setValue={setValue as unknown as UseFormSetValue<SettingsFormValues>}
            watch={watch as unknown as UseFormWatch<SettingsFormValues>}
            errors={errors}
            t={t}
          />
        </form>

        {/* Footer */}
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
            disabled={assign.isPending}
            onClick={handleSubmit(onSubmit)}
            className="flex-1 h-11 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white text-[13.5px] font-semibold shadow-pop transition-all"
          >
            {assign.isPending ? t("common.loading") : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit Mode ────────────────────────────────────────────────────────────────
function EditMode({ placeId, placeProduct, onClose }: Omit<EditProps, "mode">) {
  const { t, locale } = useTranslation();
  const update        = useUpdatePlaceProduct();
  const product       = placeProduct.product;

  const {
    register, handleSubmit, setValue, watch, reset,
    formState: { errors },
  } = useForm<EditFormData>({
    resolver:      zodResolver(editSchema),
    defaultValues: {
      is_mandatory:     placeProduct.is_mandatory,
      min_stock:        String(placeProduct.min_stock),
      display_priority: String(placeProduct.display_priority),
      is_active:        placeProduct.is_active,
    },
  });

  useEffect(() => {
    reset({
      is_mandatory:     placeProduct.is_mandatory,
      min_stock:        String(placeProduct.min_stock),
      display_priority: String(placeProduct.display_priority),
      is_active:        placeProduct.is_active,
    });
  }, [placeProduct, reset]);

  async function onSubmit(data: EditFormData) {
    await update.mutateAsync({
      placeId,
      productId: placeProduct.product_id,
      payload: {
        is_mandatory:     data.is_mandatory,
        min_stock:        parseInt(data.min_stock        ?? "0", 10),
        display_priority: parseInt(data.display_priority ?? "0", 10),
        is_active:        data.is_active,
      },
    });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm animate-fade-in" />
      <div
        className="relative w-full max-w-lg bg-white rounded-2xl shadow-modal border border-ink-100 animate-slide-up flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-ink-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-brand-500" />
            </div>
            <h2 className="text-[16px] font-bold text-ink-900">
              {t("placeProducts.edit")}
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
        <form onSubmit={handleSubmit(onSubmit)} className="overflow-y-auto px-6 py-5 flex-1">
          {/* ── Product info (read-only) ──────────────────────────────────── */}
          <SectionHeader icon={Package} label={t("placeProducts.sectionProduct")} />
          <div className="flex items-center gap-3 p-3 rounded-xl bg-ink-50 border border-ink-100 mb-3">
            <div className="w-10 h-10 rounded-xl border border-ink-100 bg-white flex items-center justify-center overflow-hidden shrink-0">
              {product?.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={product.image_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <Package className="w-4 h-4 text-ink-300" />
              )}
            </div>
            <div>
              <p className="font-semibold text-ink-800 text-[13px] leading-tight">
                {locale === "ar" ? product?.name_ar : product?.name_en}
              </p>
              <p className="text-[11px] text-ink-400">{product?.sku}</p>
            </div>
          </div>

          {/* ── Settings ────────────────────────────────────────────────── */}
          <SectionHeader icon={ShieldCheck} label={t("placeProducts.sectionSettings")} />
          <SettingsFields
            register={register as UseFormRegister<SettingsFormValues>}
            setValue={setValue as UseFormSetValue<SettingsFormValues>}
            watch={watch as UseFormWatch<SettingsFormValues>}
            errors={errors}
            t={t}
          />
        </form>

        {/* Footer */}
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
            disabled={update.isPending}
            onClick={handleSubmit(onSubmit)}
            className="flex-1 h-11 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white text-[13.5px] font-semibold shadow-pop transition-all"
          >
            {update.isPending ? t("common.loading") : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Exported wrapper ─────────────────────────────────────────────────────────
export function PlaceProductModal(props: PlaceProductModalProps) {
  if (props.mode === "assign") {
    const { mode: _, ...rest } = props;
    return <AssignMode {...rest} />;
  }
  const { mode: _, ...rest } = props;
  return <EditMode {...rest} />;
}
