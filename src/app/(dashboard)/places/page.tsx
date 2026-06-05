"use client";

import { useState, useMemo } from "react";
import {
  MapPin,
  Plus,
  Search,
  Pencil,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Building2,
  AlertCircle,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useTranslation, type TranslationFn } from "@/hooks/use-translation";
import { usePlaces } from "@/hooks/use-places";
import { useChains } from "@/hooks/use-chains";
import type { PlaceWithChain } from "@/services/places";
import { PlaceModal } from "./_components/PlaceModal";
import { DeleteModal } from "./_components/DeleteModal";

// ─── Skeleton row ─────────────────────────────────────────────────────────────
function SkeletonRow() {
  return (
    <tr className="border-b border-ink-100">
      {[...Array(5)].map((_, i) => (
        <td key={i} className="px-4 py-3.5">
          <div className="h-4 rounded-md bg-ink-100 animate-pulse w-full max-w-[140px]" />
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
        <MapPin className="w-8 h-8 text-ink-300" />
      </div>
      <h3 className="text-[15px] font-semibold text-ink-700 mb-1">
        {t("places.emptyTitle")}
      </h3>
      <p className="text-[13px] text-ink-400 mb-6 max-w-xs">
        {t("places.emptyDesc")}
      </p>
      <button
        onClick={onAdd}
        className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-[13px] font-semibold shadow-pop transition-all"
      >
        <Plus className="w-4 h-4" />
        {t("places.add")}
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
        active
          ? "bg-emerald-50 text-emerald-700"
          : "bg-ink-100 text-ink-500"
      )}
    >
      {active
        ? <ToggleRight className="w-3.5 h-3.5" />
        : <ToggleLeft  className="w-3.5 h-3.5" />}
      {active ? t("common.active") : t("common.inactive")}
    </span>
  );
}

// ─── Chain badge ──────────────────────────────────────────────────────────────
function ChainBadge({
  color,
  label,
}: {
  color: string;
  label: string;
}) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold text-white"
      style={{ backgroundColor: color }}
    >
      {label}
    </span>
  );
}

// ─── Main page component ──────────────────────────────────────────────────────
export default function PlacesPage() {
  const { t, locale } = useTranslation();
  const { data: places = [], isLoading, isError, error } = usePlaces();
  const { data: chains = [] } = useChains();

  // ── Modal state ─────────────────────────────────────────────────────────────
  const [showCreate, setShowCreate]     = useState(false);
  const [editTarget, setEditTarget]     = useState<PlaceWithChain | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PlaceWithChain | null>(null);

  // ── Search & filter ─────────────────────────────────────────────────────────
  const [search,          setSearch]          = useState("");
  const [filterChainId,   setFilterChainId]   = useState<string>("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return places.filter((p) => {
      // Chain filter
      if (filterChainId && p.chain_id !== filterChainId) return false;

      // Text search
      if (!q) return true;
      return (
        p.branch_ar.toLowerCase().includes(q) ||
        p.branch_en.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        (p.city_ar  ?? "").toLowerCase().includes(q) ||
        (p.city_en  ?? "").toLowerCase().includes(q) ||
        (p.address_ar ?? "").toLowerCase().includes(q) ||
        (p.address_en ?? "").toLowerCase().includes(q)
      );
    });
  }, [places, search, filterChainId]);

  // ── Summary stats ───────────────────────────────────────────────────────────
  const totalCount  = places.length;
  const activeCount = places.filter((p) => p.is_active).length;

  // ── Handlers ────────────────────────────────────────────────────────────────
  function openEdit(place: PlaceWithChain) {
    setEditTarget(place);
  }

  function closeEdit() {
    setEditTarget(null);
  }

  function openDelete(place: PlaceWithChain) {
    setDeleteTarget(place);
  }

  function closeDelete() {
    setDeleteTarget(null);
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-[24px] font-bold text-ink-900 flex items-center gap-2.5">
            <MapPin className="w-6 h-6 text-brand-500" />
            {t("places.pageTitle")}
          </h1>
          <p className="text-[13px] text-ink-400 mt-0.5">
            {t("places.pageSubtitle")}
          </p>
        </div>

        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-[13.5px] font-semibold shadow-pop transition-all shrink-0"
        >
          <Plus className="w-4 h-4" />
          {t("places.add")}
        </button>
      </div>

      {/* ── Stats pills ─────────────────────────────────────────────────── */}
      {!isLoading && !isError && totalCount > 0 && (
        <div className="flex flex-wrap gap-2 mb-5">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-ink-100 text-ink-600 text-[12px] font-semibold">
            <MapPin className="w-3.5 h-3.5" />
            {t("places.total").replace("{count}", String(totalCount))}
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[12px] font-semibold">
            <ToggleRight className="w-3.5 h-3.5" />
            {t("places.active").replace("{count}", String(activeCount))}
          </span>
        </div>
      )}

      {/* ── Card ────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-ink-100 shadow-soft overflow-hidden">

        {/* Toolbar: search + chain filter */}
        {!isLoading && !isError && totalCount > 0 && (
          <div className="px-4 py-3.5 border-b border-ink-100 flex flex-wrap gap-3 items-center">
            {/* Search */}
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("places.searchPlaceholder")}
                className="w-full h-9 ps-9 pe-3 rounded-lg border border-ink-200 bg-ink-50 text-[13px] text-ink-800 placeholder:text-ink-300 outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-100 transition-all"
              />
            </div>

            {/* Chain filter */}
            {chains.length > 0 && (
              <div className="relative">
                <select
                  value={filterChainId}
                  onChange={(e) => setFilterChainId(e.target.value)}
                  className="h-9 ps-3 pe-8 rounded-lg border border-ink-200 bg-ink-50 text-[13px] text-ink-700 outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-100 transition-all appearance-none cursor-pointer"
                >
                  <option value="">{t("places.allChains")}</option>
                  {chains.map((c) => (
                    <option key={c.id} value={c.id}>
                      {locale === "ar" ? c.name_ar : c.name_en}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute end-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none" />
              </div>
            )}
          </div>
        )}

        {/* ── Loading ─────────────────────────────────────────────────── */}
        {isLoading && (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <TableHead t={t} />
              </thead>
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
              <thead>
                <TableHead t={t} />
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-ink-400 text-[13px]">
                      {t("common.noData")}
                    </td>
                  </tr>
                ) : (
                  filtered.map((place) => (
                    <PlaceRow
                      key={place.id}
                      place={place}
                      locale={locale}
                      t={t}
                      onEdit={() => openEdit(place)}
                      onDelete={() => openDelete(place)}
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
        <PlaceModal onClose={() => setShowCreate(false)} />
      )}
      {editTarget && (
        <PlaceModal place={editTarget} onClose={closeEdit} />
      )}
      {deleteTarget && (
        <DeleteModal place={deleteTarget} onClose={closeDelete} />
      )}
    </>
  );
}

// ─── Table head ───────────────────────────────────────────────────────────────
function TableHead({ t }: { t: TranslationFn }) {
  return (
    <tr className="border-b border-ink-100 bg-ink-50/60">
      <th className="px-4 py-3 text-start text-[11.5px] font-semibold text-ink-400 uppercase tracking-wide">
        {t("nav.places")}
      </th>
      <th className="px-4 py-3 text-start text-[11.5px] font-semibold text-ink-400 uppercase tracking-wide">
        {t("places.code")}
      </th>
      <th className="px-4 py-3 text-start text-[11.5px] font-semibold text-ink-400 uppercase tracking-wide">
        {t("places.cityAr")} / {t("places.region")}
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
interface PlaceRowProps {
  place:    PlaceWithChain;
  locale:   string;
  t:        TranslationFn;
  onEdit:   () => void;
  onDelete: () => void;
}

function PlaceRow({ place, locale, t, onEdit, onDelete }: PlaceRowProps) {
  const primaryName   = locale === "ar" ? place.branch_ar : place.branch_en;
  const secondaryName = locale === "ar" ? place.branch_en : place.branch_ar;
  const city          = locale === "ar" ? (place.city_ar ?? place.city_en) : (place.city_en ?? place.city_ar);
  const chainColor    = place.chain?.color ?? "#111827";
  const chainLabel    = place.chain
    ? (locale === "ar" ? place.chain.name_ar : place.chain.name_en)
    : "";

  // Optimistic placeholder rows look slightly faded.
  const isOptimistic = place.id === "__optimistic__";

  return (
    <tr
      className={cn(
        "border-b border-ink-100 hover:bg-ink-50/50 transition-colors group",
        isOptimistic && "opacity-60 pointer-events-none"
      )}
    >
      {/* Branch identity */}
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-3">
          {/* Chain color dot */}
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-white font-bold text-[13px]"
            style={{ backgroundColor: chainColor }}
          >
            {primaryName.charAt(0)}
          </div>
          <div>
            <p className="font-semibold text-ink-800 leading-tight">{primaryName}</p>
            <p className="text-[11.5px] text-ink-400 leading-tight">{secondaryName}</p>
            {chainLabel && (
              <ChainBadge color={chainColor} label={chainLabel} />
            )}
          </div>
        </div>
      </td>

      {/* Code */}
      <td className="px-4 py-3.5">
        <code className="px-2 py-0.5 rounded-md bg-ink-100 text-ink-600 text-[12px] font-mono font-semibold">
          {place.code}
        </code>
      </td>

      {/* City / Region */}
      <td className="px-4 py-3.5">
        <div className="text-ink-700">
          {city ? (
            <span className="font-medium">{city}</span>
          ) : (
            <span className="text-ink-300">—</span>
          )}
          {place.region && (
            <p className="text-[11.5px] text-ink-400">{place.region}</p>
          )}
        </div>
      </td>

      {/* Status */}
      <td className="px-4 py-3.5">
        <StatusBadge active={place.is_active} t={t} />
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
