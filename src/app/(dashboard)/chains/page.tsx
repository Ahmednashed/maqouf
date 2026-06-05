"use client";

import { useState, useMemo } from "react";
import type { Metadata } from "next";
import {
  Store,
  Plus,
  Search,
  Pencil,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Building2,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useTranslation, type TranslationFn } from "@/hooks/use-translation";
import { useChains } from "@/hooks/use-chains";
import type { ChainWithCount } from "@/services/chains";
import type { Chain } from "@/types";
import { ChainModal } from "./_components/ChainModal";
import { DeleteModal } from "./_components/DeleteModal";

// ─── Skeleton row ─────────────────────────────────────────────────────────────
function SkeletonRow() {
  return (
    <tr className="border-b border-ink-100">
      {[...Array(5)].map((_, i) => (
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
        <Building2 className="w-8 h-8 text-ink-300" />
      </div>
      <h3 className="text-[15px] font-semibold text-ink-700 mb-1">
        {t("chains.emptyTitle")}
      </h3>
      <p className="text-[13px] text-ink-400 mb-6 max-w-xs">
        {t("chains.emptyDesc")}
      </p>
      <button
        onClick={onAdd}
        className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-[13px] font-semibold shadow-pop transition-all"
      >
        <Plus className="w-4 h-4" />
        {t("chains.add")}
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

// ─── Main page component ──────────────────────────────────────────────────────
export default function ChainsPage() {
  const { t, locale } = useTranslation();
  const { data: chains = [], isLoading, isError, error } = useChains();

  // ── Modal state ─────────────────────────────────────────────────────────────
  const [showCreate, setShowCreate]           = useState(false);
  const [editTarget, setEditTarget]           = useState<Chain | null>(null);
  const [deleteTarget, setDeleteTarget]       = useState<ChainWithCount | null>(null);

  // ── Search ──────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return chains;
    return chains.filter(
      (c) =>
        c.name_ar.toLowerCase().includes(q) ||
        c.name_en.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q)
    );
  }, [chains, search]);

  // ── Summary stats ───────────────────────────────────────────────────────────
  const totalCount  = chains.length;
  const activeCount = chains.filter((c) => c.is_active).length;

  // ── Handlers ────────────────────────────────────────────────────────────────
  function openEdit(chain: Chain) {
    setEditTarget(chain);
  }

  function closeEdit() {
    setEditTarget(null);
  }

  function openDelete(chain: ChainWithCount) {
    setDeleteTarget(chain);
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
            <Store className="w-6 h-6 text-brand-500" />
            {t("chains.pageTitle")}
          </h1>
          <p className="text-[13px] text-ink-400 mt-0.5">
            {t("chains.pageSubtitle")}
          </p>
        </div>

        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-[13.5px] font-semibold shadow-pop transition-all shrink-0"
        >
          <Plus className="w-4 h-4" />
          {t("chains.add")}
        </button>
      </div>

      {/* ── Stats pills ─────────────────────────────────────────────────── */}
      {!isLoading && !isError && totalCount > 0 && (
        <div className="flex flex-wrap gap-2 mb-5">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-ink-100 text-ink-600 text-[12px] font-semibold">
            <Building2 className="w-3.5 h-3.5" />
            {t("chains.total").replace("{count}", String(totalCount))}
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[12px] font-semibold">
            <ToggleRight className="w-3.5 h-3.5" />
            {t("chains.active").replace("{count}", String(activeCount))}
          </span>
        </div>
      )}

      {/* ── Card ────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-ink-100 shadow-soft overflow-hidden">

        {/* Search toolbar */}
        {!isLoading && !isError && totalCount > 0 && (
          <div className="px-4 py-3.5 border-b border-ink-100">
            <div className="relative max-w-xs">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("chains.searchPlaceholder")}
                className="w-full h-9 ps-9 pe-3 rounded-lg border border-ink-200 bg-ink-50 text-[13px] text-ink-800 placeholder:text-ink-300 outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-100 transition-all"
              />
            </div>
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
                {[...Array(4)].map((_, i) => <SkeletonRow key={i} />)}
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
                  filtered.map((chain) => (
                    <ChainRow
                      key={chain.id}
                      chain={chain}
                      locale={locale}
                      t={t}
                      onEdit={() => openEdit(chain)}
                      onDelete={() => openDelete(chain)}
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
        <ChainModal onClose={() => setShowCreate(false)} />
      )}
      {editTarget && (
        <ChainModal chain={editTarget} onClose={closeEdit} />
      )}
      {deleteTarget && (
        <DeleteModal chain={deleteTarget} onClose={closeDelete} />
      )}
    </>
  );
}

// ─── Table head ───────────────────────────────────────────────────────────────
function TableHead({ t }: { t: TranslationFn }) {
  return (
    <tr className="border-b border-ink-100 bg-ink-50/60">
      <th className="px-4 py-3 text-start text-[11.5px] font-semibold text-ink-400 uppercase tracking-wide">
        {t("nav.chains")}
      </th>
      <th className="px-4 py-3 text-start text-[11.5px] font-semibold text-ink-400 uppercase tracking-wide">
        {t("chains.code")}
      </th>
      <th className="px-4 py-3 text-start text-[11.5px] font-semibold text-ink-400 uppercase tracking-wide">
        {t("nav.places")}
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
interface ChainRowProps {
  chain:    ChainWithCount;
  locale:   string;
  t:        TranslationFn;
  onEdit:   () => void;
  onDelete: () => void;
}

function ChainRow({ chain, locale, t, onEdit, onDelete }: ChainRowProps) {
  const primaryName   = locale === "ar" ? chain.name_ar : chain.name_en;
  const secondaryName = locale === "ar" ? chain.name_en : chain.name_ar;

  // Optimistic placeholder rows look slightly faded.
  const isOptimistic = chain.id === "__optimistic__";

  return (
    <tr
      className={cn(
        "border-b border-ink-100 hover:bg-ink-50/50 transition-colors group",
        isOptimistic && "opacity-60 pointer-events-none"
      )}
    >
      {/* Chain identity */}
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-3">
          {/* Color dot / avatar */}
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-white font-bold text-[13px]"
            style={{ backgroundColor: chain.color ?? "#111827" }}
          >
            {primaryName.charAt(0)}
          </div>
          <div>
            <p className="font-semibold text-ink-800 leading-tight">{primaryName}</p>
            <p className="text-[11.5px] text-ink-400 leading-tight">{secondaryName}</p>
          </div>
        </div>
      </td>

      {/* Code */}
      <td className="px-4 py-3.5">
        <code className="px-2 py-0.5 rounded-md bg-ink-100 text-ink-600 text-[12px] font-mono font-semibold">
          {chain.code}
        </code>
      </td>

      {/* Places count */}
      <td className="px-4 py-3.5">
        <span className="inline-flex items-center gap-1 text-ink-600 font-medium">
          <Building2 className="w-3.5 h-3.5 text-ink-400" />
          {chain.places_count}
        </span>
      </td>

      {/* Status */}
      <td className="px-4 py-3.5">
        <StatusBadge active={chain.is_active} t={t} />
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
