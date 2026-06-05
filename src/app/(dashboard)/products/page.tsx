"use client";

import { useState, useMemo } from "react";
import {
  Package,
  Plus,
  Search,
  Pencil,
  Trash2,
  ToggleLeft,
  ToggleRight,
  AlertCircle,
  ChevronDown,
  Tag,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useTranslation, type TranslationFn } from "@/hooks/use-translation";
import { useProducts } from "@/hooks/use-products";
import type { Product, ProductCategory } from "@/types";
import { ProductModal } from "./_components/ProductModal";
import { DeleteModal } from "./_components/DeleteModal";

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORIES: ProductCategory[] = [
  "beverages", "snacks", "dairy", "bakery", "frozen",
];

/** Tailwind colour classes per category for the badge. */
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
      {[...Array(6)].map((_, i) => (
        <td key={i} className="px-4 py-3.5">
          <div className="h-4 rounded-md bg-ink-100 animate-pulse w-full max-w-[120px]" />
        </td>
      ))}
    </tr>
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
        {t("products.emptyTitle")}
      </h3>
      <p className="text-[13px] text-ink-400 mb-6 max-w-xs">
        {t("products.emptyDesc")}
      </p>
      <button
        onClick={onAdd}
        className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-[13px] font-semibold shadow-pop transition-all"
      >
        <Plus className="w-4 h-4" />
        {t("products.add")}
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

// ─── Category badge ───────────────────────────────────────────────────────────
function CategoryBadge({
  category,
  label,
}: {
  category: ProductCategory;
  label: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold",
        CAT_COLORS[category]
      )}
    >
      <Tag className="w-2.5 h-2.5" />
      {label}
    </span>
  );
}

// ─── Main page component ──────────────────────────────────────────────────────
export default function ProductsPage() {
  const { t, locale } = useTranslation();
  const { data: products = [], isLoading, isError, error } = useProducts();

  // ── Modal state ─────────────────────────────────────────────────────────────
  const [showCreate,    setShowCreate]    = useState(false);
  const [editTarget,    setEditTarget]    = useState<Product | null>(null);
  const [deleteTarget,  setDeleteTarget]  = useState<Product | null>(null);

  // ── Search & filter ─────────────────────────────────────────────────────────
  const [search,           setSearch]           = useState("");
  const [filterCategory,   setFilterCategory]   = useState<string>("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return products.filter((p) => {
      if (filterCategory && p.category !== filterCategory) return false;
      if (!q) return true;
      return (
        p.name_ar.toLowerCase().includes(q) ||
        p.name_en.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q)
      );
    });
  }, [products, search, filterCategory]);

  // ── Summary stats ───────────────────────────────────────────────────────────
  const totalCount  = products.length;
  const activeCount = products.filter((p) => p.is_active).length;

  // ── Handlers ────────────────────────────────────────────────────────────────
  function openEdit(product: Product) { setEditTarget(product); }
  function closeEdit()                { setEditTarget(null); }
  function openDelete(product: Product) { setDeleteTarget(product); }
  function closeDelete()              { setDeleteTarget(null); }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-[24px] font-bold text-ink-900 flex items-center gap-2.5">
            <Package className="w-6 h-6 text-brand-500" />
            {t("products.pageTitle")}
          </h1>
          <p className="text-[13px] text-ink-400 mt-0.5">
            {t("products.pageSubtitle")}
          </p>
        </div>

        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-[13.5px] font-semibold shadow-pop transition-all shrink-0"
        >
          <Plus className="w-4 h-4" />
          {t("products.add")}
        </button>
      </div>

      {/* ── Stats pills ─────────────────────────────────────────────────── */}
      {!isLoading && !isError && totalCount > 0 && (
        <div className="flex flex-wrap gap-2 mb-5">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-ink-100 text-ink-600 text-[12px] font-semibold">
            <Package className="w-3.5 h-3.5" />
            {t("products.total").replace("{count}", String(totalCount))}
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[12px] font-semibold">
            <ToggleRight className="w-3.5 h-3.5" />
            {t("products.active").replace("{count}", String(activeCount))}
          </span>
        </div>
      )}

      {/* ── Card ────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-ink-100 shadow-soft overflow-hidden">

        {/* Toolbar */}
        {!isLoading && !isError && totalCount > 0 && (
          <div className="px-4 py-3.5 border-b border-ink-100 flex flex-wrap gap-3 items-center">
            {/* Search */}
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("products.searchPlaceholder")}
                className="w-full h-9 ps-9 pe-3 rounded-lg border border-ink-200 bg-ink-50 text-[13px] text-ink-800 placeholder:text-ink-300 outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-100 transition-all"
              />
            </div>

            {/* Category filter */}
            <div className="relative">
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="h-9 ps-3 pe-8 rounded-lg border border-ink-200 bg-ink-50 text-[13px] text-ink-700 outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-100 transition-all appearance-none cursor-pointer"
              >
                <option value="">{t("products.allCategories")}</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`products.cat.${c}` as Parameters<typeof t>[0])}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute end-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none" />
            </div>
          </div>
        )}

        {/* ── Loading ─────────────────────────────────────────────────── */}
        {isLoading && (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><TableHead t={t} /></thead>
              <tbody>
                {[...Array(5)].map((_, i) => <SkeletonRow key={i} />)}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Error ───────────────────────────────────────────────────── */}
        {isError && (
          <ErrorState message={(error as Error)?.message ?? t("common.noData")} />
        )}

        {/* ── Empty ───────────────────────────────────────────────────── */}
        {!isLoading && !isError && totalCount === 0 && (
          <EmptyState onAdd={() => setShowCreate(true)} t={t} />
        )}

        {/* ── Table ───────────────────────────────────────────────────── */}
        {!isLoading && !isError && totalCount > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><TableHead t={t} /></thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-ink-400 text-[13px]">
                      {t("common.noData")}
                    </td>
                  </tr>
                ) : (
                  filtered.map((product) => (
                    <ProductRow
                      key={product.id}
                      product={product}
                      locale={locale}
                      t={t}
                      onEdit={() => openEdit(product)}
                      onDelete={() => openDelete(product)}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Modals ──────────────────────────────────────────────────────── */}
      {showCreate && (
        <ProductModal onClose={() => setShowCreate(false)} />
      )}
      {editTarget && (
        <ProductModal product={editTarget} onClose={closeEdit} />
      )}
      {deleteTarget && (
        <DeleteModal product={deleteTarget} onClose={closeDelete} />
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
        {t("products.priceLabel")}
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
interface ProductRowProps {
  product:  Product;
  locale:   string;
  t:        TranslationFn;
  onEdit:   () => void;
  onDelete: () => void;
}

function ProductRow({ product, locale, t, onEdit, onDelete }: ProductRowProps) {
  const primaryName   = locale === "ar" ? product.name_ar : product.name_en;
  const secondaryName = locale === "ar" ? product.name_en : product.name_ar;
  const catLabel      = t(`products.cat.${product.category}` as Parameters<typeof t>[0]);
  const unitLabel     = t(`products.unit.${product.unit}` as Parameters<typeof t>[0]);
  const isOptimistic  = product.id === "__optimistic__";

  return (
    <tr
      className={cn(
        "border-b border-ink-100 hover:bg-ink-50/50 transition-colors group",
        isOptimistic && "opacity-60 pointer-events-none"
      )}
    >
      {/* Product identity */}
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-3">
          {/* Image avatar or icon */}
          <div className="w-10 h-10 rounded-xl border border-ink-100 bg-ink-50 flex items-center justify-center overflow-hidden shrink-0">
            {product.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={product.image_url}
                alt={primaryName}
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <Package className="w-4.5 h-4.5 text-ink-300" />
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
          {product.sku}
        </code>
      </td>

      {/* Category + Unit */}
      <td className="px-4 py-3.5">
        <div className="flex flex-col gap-1">
          <CategoryBadge category={product.category} label={catLabel} />
          <span className="text-[11px] text-ink-400">{unitLabel}</span>
        </div>
      </td>

      {/* Price */}
      <td className="px-4 py-3.5">
        {product.price != null ? (
          <div>
            <span className="font-semibold text-ink-800 text-[13px]">
              {product.price.toFixed(2)}
            </span>
            {product.cost != null && (
              <p className="text-[11px] text-ink-400">
                {t("products.costPrice")}: {product.cost.toFixed(2)}
              </p>
            )}
          </div>
        ) : (
          <span className="text-ink-300">—</span>
        )}
      </td>

      {/* Status */}
      <td className="px-4 py-3.5">
        <StatusBadge active={product.is_active} t={t} />
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
            onClick={onDelete}
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
