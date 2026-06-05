"use client";

import { useState, useMemo } from "react";
import {
  Layers,
  Plus,
  Search,
  Pencil,
  Trash2,
  ToggleLeft,
  ToggleRight,
  AlertCircle,
  ChevronDown,
  Package,
  ShieldCheck,
  MapPin,
  Tag,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useTranslation, type TranslationFn } from "@/hooks/use-translation";
import { usePlaces } from "@/hooks/use-places";
import { usePlaceProducts } from "@/hooks/use-place-products";
import type { PlaceProductWithProduct } from "@/services/place-products";
import type { PlaceWithChain } from "@/services/places";
import type { ProductCategory } from "@/types";
import { PlaceProductModal } from "./_components/PlaceProductModal";
import { RemoveModal } from "./_components/RemoveModal";

// ─── Category colour map (same as Products page) ──────────────────────────────
const CAT_COLORS: Record<ProductCategory, string> = {
  beverages: "bg-sky-50    text-sky-700",
  snacks:    "bg-amber-50  text-amber-700",
  dairy:     "bg-blue-50   text-blue-700",
  bakery:    "bg-orange-50 text-orange-700",
  frozen:    "bg-cyan-50   text-cyan-700",
};

// ─── Skeleton row ─────────────────────────────────────────────────────────────
function SkeletonRow() {
  return (
    <tr className="border-b border-ink-100">
      {[...Array(8)].map((_, i) => (
        <td key={i} className="px-4 py-3.5">
          <div className="h-4 rounded-md bg-ink-100 animate-pulse w-full max-w-[100px]" />
        </td>
      ))}
    </tr>
  );
}

// ─── Branch selector hero ─────────────────────────────────────────────────────
interface BranchSelectorProps {
  places:     PlaceWithChain[];
  selectedId: string;
  onChange:   (id: string) => void;
  locale:     string;
  t:          TranslationFn;
}

function BranchSelector({ places, selectedId, onChange, locale, t }: BranchSelectorProps) {
  const selected = places.find((p) => p.id === selectedId);

  return (
    <div className="bg-white rounded-2xl border border-ink-100 shadow-soft p-5 mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        {/* Branch dropdown */}
        <div className="flex-1">
          <label className="block text-[11.5px] font-bold text-ink-500 uppercase tracking-wide mb-1.5">
            {t("placeProducts.selectBranchTitle")}
          </label>
          <div className="relative max-w-sm">
            <MapPin className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400 pointer-events-none z-10" />
            <ChevronDown className="absolute end-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400 pointer-events-none z-10" />
            <select
              value={selectedId}
              onChange={(e) => onChange(e.target.value)}
              className="w-full h-11 ps-10 pe-9 rounded-xl border border-ink-200 bg-white text-[13.5px] text-ink-800 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-50 transition-all appearance-none cursor-pointer font-medium"
            >
              <option value="">{t("placeProducts.branchPlaceholder")}</option>
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {locale === "ar" ? p.branch_ar : p.branch_en}
                  {p.chain ? ` — ${locale === "ar" ? p.chain.name_ar : p.chain.name_en}` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Selected branch info */}
        {selected && (
          <div
            className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-white text-[13px] font-semibold"
            style={{ backgroundColor: selected.chain?.color ?? "#111827" }}
          >
            <MapPin className="w-4 h-4 shrink-0" />
            <div className="leading-tight">
              <p>{locale === "ar" ? selected.branch_ar : selected.branch_en}</p>
              {selected.chain && (
                <p className="text-[11px] opacity-75 font-normal">
                  {locale === "ar" ? selected.chain.name_ar : selected.chain.name_en}
                  {" · "}{selected.code}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {!selectedId && (
        <p className="mt-3 text-[12.5px] text-ink-400">
          {t("placeProducts.selectBranchDesc")}
        </p>
      )}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────
function EmptyState({ onAdd, t }: { onAdd: () => void; t: TranslationFn }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-2xl bg-ink-100 flex items-center justify-center mb-4">
        <Package className="w-8 h-8 text-ink-300" />
      </div>
      <h3 className="text-[15px] font-semibold text-ink-700 mb-1">
        {t("placeProducts.emptyTitle")}
      </h3>
      <p className="text-[13px] text-ink-400 mb-6 max-w-xs">
        {t("placeProducts.emptyDesc")}
      </p>
      <button
        onClick={onAdd}
        className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-[13px] font-semibold shadow-pop transition-all"
      >
        <Plus className="w-4 h-4" />
        {t("placeProducts.assign")}
      </button>
    </div>
  );
}

// ─── Error state ──────────────────────────────────────────────────────────────
function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-14 h-14 rounded-2xl bg-rose-50 flex items-center justify-center mb-4">
        <AlertCircle className="w-7 h-7 text-rose-400" />
      </div>
      <p className="text-[13px] text-rose-500">{message}</p>
    </div>
  );
}

// ─── No branch selected ───────────────────────────────────────────────────────
function NoBranchState({ t }: { t: TranslationFn }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-2xl bg-ink-100 flex items-center justify-center mb-4">
        <Layers className="w-8 h-8 text-ink-300" />
      </div>
      <h3 className="text-[15px] font-semibold text-ink-700 mb-1">
        {t("placeProducts.selectBranchTitle")}
      </h3>
      <p className="text-[13px] text-ink-400 max-w-xs">
        {t("placeProducts.selectBranchDesc")}
      </p>
    </div>
  );
}

// ─── Mandatory badge ──────────────────────────────────────────────────────────
function MandatoryBadge({ mandatory, t }: { mandatory: boolean; t: TranslationFn }) {
  if (!mandatory) return <span className="text-[12px] text-ink-400">{t("placeProducts.no")}</span>;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[11px] font-semibold">
      <ShieldCheck className="w-2.5 h-2.5" />
      {t("placeProducts.yes")}
    </span>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ active, t }: { active: boolean; t: TranslationFn }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11.5px] font-semibold",
        active ? "bg-emerald-50 text-emerald-700" : "bg-ink-100 text-ink-500"
      )}
    >
      {active ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
      {active ? t("common.active") : t("common.inactive")}
    </span>
  );
}

// ─── Main page component ──────────────────────────────────────────────────────
export default function PlaceProductsPage() {
  const { t, locale } = useTranslation();
  const { data: places = [], isLoading: placesLoading } = usePlaces();

  // ── Selected branch ─────────────────────────────────────────────────────────
  const [selectedPlaceId, setSelectedPlaceId] = useState<string>("");

  // ── Place-products data for selected branch ─────────────────────────────────
  const {
    data: placeProducts = [],
    isLoading: ppLoading,
    isError: ppError,
    error: ppErrorObj,
  } = usePlaceProducts(selectedPlaceId || null);

  // ── Modal state ─────────────────────────────────────────────────────────────
  const [showAssign,    setShowAssign]    = useState(false);
  const [editTarget,    setEditTarget]    = useState<PlaceProductWithProduct | null>(null);
  const [removeTarget,  setRemoveTarget]  = useState<PlaceProductWithProduct | null>(null);

  // ── Search ──────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return placeProducts;
    return placeProducts.filter((pp) => {
      const p = pp.product;
      return (
        p.name_ar.toLowerCase().includes(q) ||
        p.name_en.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q)
      );
    });
  }, [placeProducts, search]);

  // ── Stats ───────────────────────────────────────────────────────────────────
  const totalCount     = placeProducts.length;
  const mandatoryCount = placeProducts.filter((pp) => pp.is_mandatory).length;

  const activePlaces = useMemo(
    () => places.filter((p) => p.is_active),
    [places]
  );

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-[24px] font-bold text-ink-900 flex items-center gap-2.5">
            <Layers className="w-6 h-6 text-brand-500" />
            {t("placeProducts.pageTitle")}
          </h1>
          <p className="text-[13px] text-ink-400 mt-0.5">
            {t("placeProducts.pageSubtitle")}
          </p>
        </div>

        {selectedPlaceId && (
          <button
            onClick={() => setShowAssign(true)}
            className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-[13.5px] font-semibold shadow-pop transition-all shrink-0"
          >
            <Plus className="w-4 h-4" />
            {t("placeProducts.assign")}
          </button>
        )}
      </div>

      {/* ── Branch selector ──────────────────────────────────────────────── */}
      <BranchSelector
        places={placesLoading ? [] : activePlaces}
        selectedId={selectedPlaceId}
        onChange={(id) => {
          setSelectedPlaceId(id);
          setSearch("");
        }}
        locale={locale}
        t={t}
      />

      {/* ── Nothing selected ──────────────────────────────────────────── */}
      {!selectedPlaceId && (
        <div className="bg-white rounded-2xl border border-ink-100 shadow-soft overflow-hidden">
          <NoBranchState t={t} />
        </div>
      )}

      {/* ── Branch selected: stats + table ───────────────────────────── */}
      {selectedPlaceId && (
        <>
          {/* Stats pills */}
          {!ppLoading && !ppError && totalCount > 0 && (
            <div className="flex flex-wrap gap-2 mb-5">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-ink-100 text-ink-600 text-[12px] font-semibold">
                <Package className="w-3.5 h-3.5" />
                {t("placeProducts.total").replace("{count}", String(totalCount))}
              </span>
              {mandatoryCount > 0 && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-700 text-[12px] font-semibold">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  {t("placeProducts.mandatory").replace("{count}", String(mandatoryCount))}
                </span>
              )}
            </div>
          )}

          <div className="bg-white rounded-2xl border border-ink-100 shadow-soft overflow-hidden">
            {/* Toolbar */}
            {!ppLoading && !ppError && totalCount > 0 && (
              <div className="px-4 py-3.5 border-b border-ink-100">
                <div className="relative max-w-xs">
                  <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400 pointer-events-none" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t("placeProducts.searchPlaceholder")}
                    className="w-full h-9 ps-9 pe-3 rounded-lg border border-ink-200 bg-ink-50 text-[13px] text-ink-800 placeholder:text-ink-300 outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-100 transition-all"
                  />
                </div>
              </div>
            )}

            {/* Loading */}
            {ppLoading && (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead><TableHead t={t} /></thead>
                  <tbody>
                    {[...Array(4)].map((_, i) => <SkeletonRow key={i} />)}
                  </tbody>
                </table>
              </div>
            )}

            {/* Error */}
            {ppError && (
              <ErrorState message={(ppErrorObj as Error)?.message ?? t("common.noData")} />
            )}

            {/* Empty */}
            {!ppLoading && !ppError && totalCount === 0 && (
              <EmptyState onAdd={() => setShowAssign(true)} t={t} />
            )}

            {/* Table */}
            {!ppLoading && !ppError && totalCount > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead><TableHead t={t} /></thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-12 text-center text-ink-400 text-[13px]">
                          {t("common.noData")}
                        </td>
                      </tr>
                    ) : (
                      filtered.map((pp) => (
                        <PlaceProductRow
                          key={pp.product_id}
                          placeProduct={pp}
                          locale={locale}
                          t={t}
                          onEdit={() => setEditTarget(pp)}
                          onRemove={() => setRemoveTarget(pp)}
                        />
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Modals ──────────────────────────────────────────────────────── */}
      {showAssign && selectedPlaceId && (
        <PlaceProductModal
          mode="assign"
          placeId={selectedPlaceId}
          assignedProducts={placeProducts}
          onClose={() => setShowAssign(false)}
        />
      )}
      {editTarget && selectedPlaceId && (
        <PlaceProductModal
          mode="edit"
          placeId={selectedPlaceId}
          placeProduct={editTarget}
          onClose={() => setEditTarget(null)}
        />
      )}
      {removeTarget && selectedPlaceId && (
        <RemoveModal
          placeId={selectedPlaceId}
          placeProduct={removeTarget}
          onClose={() => setRemoveTarget(null)}
        />
      )}
    </>
  );
}

// ─── Table head ───────────────────────────────────────────────────────────────
function TableHead({ t }: { t: TranslationFn }) {
  return (
    <tr className="border-b border-ink-100 bg-ink-50/60">
      <th className="px-4 py-3 text-start text-[11.5px] font-semibold text-ink-400 uppercase tracking-wide">
        {t("nav.products")}
      </th>
      <th className="px-4 py-3 text-start text-[11.5px] font-semibold text-ink-400 uppercase tracking-wide">
        {t("products.sku")}
      </th>
      <th className="px-4 py-3 text-start text-[11.5px] font-semibold text-ink-400 uppercase tracking-wide">
        {t("products.category")}
      </th>
      <th className="px-4 py-3 text-start text-[11.5px] font-semibold text-ink-400 uppercase tracking-wide">
        {t("placeProducts.colMandatory")}
      </th>
      <th className="px-4 py-3 text-start text-[11.5px] font-semibold text-ink-400 uppercase tracking-wide">
        {t("placeProducts.colMinStock")}
      </th>
      <th className="px-4 py-3 text-start text-[11.5px] font-semibold text-ink-400 uppercase tracking-wide">
        {t("placeProducts.colPriority")}
      </th>
      <th className="px-4 py-3 text-start text-[11.5px] font-semibold text-ink-400 uppercase tracking-wide">
        {t("common.status")}
      </th>
      <th className="px-4 py-3 text-end text-[11.5px] font-semibold text-ink-400 uppercase tracking-wide">
        {t("common.actions")}
      </th>
    </tr>
  );
}

// ─── Table row ────────────────────────────────────────────────────────────────
interface PlaceProductRowProps {
  placeProduct: PlaceProductWithProduct;
  locale:       string;
  t:            TranslationFn;
  onEdit:       () => void;
  onRemove:     () => void;
}

function PlaceProductRow({ placeProduct, locale, t, onEdit, onRemove }: PlaceProductRowProps) {
  const product       = placeProduct.product;
  const primaryName   = locale === "ar" ? product?.name_ar : product?.name_en;
  const secondaryName = locale === "ar" ? product?.name_en : product?.name_ar;
  const catLabel      = product
    ? t(`products.cat.${product.category}` as Parameters<typeof t>[0])
    : "—";

  return (
    <tr className="border-b border-ink-100 hover:bg-ink-50/50 transition-colors group">
      {/* Product identity */}
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl border border-ink-100 bg-ink-50 flex items-center justify-center overflow-hidden shrink-0">
            {product?.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={product.image_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <Package className="w-4 h-4 text-ink-300" />
            )}
          </div>
          <div>
            <p className="font-semibold text-ink-800 leading-tight">{primaryName}</p>
            <p className="text-[11.5px] text-ink-400 leading-tight">{secondaryName}</p>
          </div>
        </div>
      </td>

      {/* SKU */}
      <td className="px-4 py-3.5">
        <code className="px-2 py-0.5 rounded-md bg-ink-100 text-ink-600 text-[12px] font-mono font-semibold">
          {product?.sku}
        </code>
      </td>

      {/* Category */}
      <td className="px-4 py-3.5">
        {product ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold",
              CAT_COLORS[product.category]
            )}
          >
            <Tag className="w-2.5 h-2.5" />
            {catLabel}
          </span>
        ) : (
          <span className="text-ink-300">—</span>
        )}
      </td>

      {/* Mandatory */}
      <td className="px-4 py-3.5">
        <MandatoryBadge mandatory={placeProduct.is_mandatory} t={t} />
      </td>

      {/* Min Stock */}
      <td className="px-4 py-3.5">
        <span className="font-medium text-ink-700">
          {placeProduct.min_stock}
        </span>
      </td>

      {/* Priority */}
      <td className="px-4 py-3.5">
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-ink-100 text-ink-600 text-[12px] font-semibold">
          {placeProduct.display_priority}
        </span>
      </td>

      {/* Status */}
      <td className="px-4 py-3.5">
        <StatusBadge active={placeProduct.is_active} t={t} />
      </td>

      {/* Actions */}
      <td className="px-4 py-3.5">
        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={onEdit}
            title={t("common.edit")}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-400 hover:text-brand-500 hover:bg-brand-50 transition-all"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onRemove}
            title={t("common.delete")}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-400 hover:text-rose-500 hover:bg-rose-50 transition-all"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}
