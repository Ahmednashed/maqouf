"use client";

import { AlertTriangle, Trash2, X } from "lucide-react";
import { useTranslation } from "@/hooks/use-translation";
import { useRemovePlaceProduct } from "@/hooks/use-place-products";
import type { PlaceProductWithProduct } from "@/services/place-products";

interface RemoveModalProps {
  placeId:      string;
  placeProduct: PlaceProductWithProduct;
  onClose:      () => void;
}

export function RemoveModal({ placeId, placeProduct, onClose }: RemoveModalProps) {
  const { t, locale } = useTranslation();
  const remove        = useRemovePlaceProduct();

  const product     = placeProduct.product;
  const productName = locale === "ar" ? product?.name_ar : product?.name_en;

  async function handleRemove() {
    await remove.mutateAsync({
      placeId,
      productId: placeProduct.product_id,
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
          <div className="w-14 h-14 rounded-2xl bg-rose-50 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-7 h-7 text-rose-500" />
          </div>

          <h2 className="text-[16px] font-bold text-ink-900 mb-1">
            {t("placeProducts.confirmRemoveTitle")}
          </h2>

          {/* Product pill */}
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-ink-100 text-[12px] font-semibold text-ink-700 my-2">
            {productName}
            <span className="text-ink-400 font-mono text-[11px]">({product?.sku})</span>
          </div>

          <p className="text-[12.5px] text-ink-500 leading-relaxed mt-2">
            {t("placeProducts.confirmRemoveMsg")}
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
            onClick={handleRemove}
            disabled={remove.isPending}
            className="flex-1 h-10 rounded-xl bg-rose-500 hover:bg-rose-600 disabled:opacity-60 text-white text-[13px] font-semibold flex items-center justify-center gap-1.5 transition-all"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {remove.isPending ? t("common.loading") : t("common.delete")}
          </button>
        </div>
      </div>
    </div>
  );
}
