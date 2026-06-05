"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, FileText, Hash, Eye, Pencil, Trash2,
  CheckCircle, Clock, Search, LayoutGrid,
} from "lucide-react";
import { useTranslation } from "@/hooks/use-translation";
import { useTemplates } from "@/hooks/use-templates";
import { TemplateModal }       from "./_components/TemplateModal";
import { DeleteTemplateModal } from "./_components/DeleteTemplateModal";
import type { TemplateListItem } from "@/types";

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  if (status === "active") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100">
        <CheckCircle className="w-3 h-3" />
        {t("templates.statusActive")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-100">
      <Clock className="w-3 h-3" />
      {t("templates.statusDraft")}
    </span>
  );
}

// ─── Template card ────────────────────────────────────────────────────────────

interface CardProps {
  template:  TemplateListItem;
  onEdit:    (t: TemplateListItem) => void;
  onDelete:  (t: TemplateListItem) => void;
  onOpen:    (id: string) => void;
}

function TemplateCard({ template, onEdit, onDelete, onOpen }: CardProps) {
  const { t, locale } = useTranslation();
  const name          = locale === "ar" ? template.name_ar : template.name_en;
  const altName       = locale === "ar" ? template.name_en : template.name_ar;

  return (
    <div
      className="group bg-white rounded-2xl border border-ink-100 shadow-card hover:shadow-card-hover hover:border-brand-200 transition-all cursor-pointer overflow-hidden"
      onClick={() => onOpen(template.id)}
    >
      {/* Top accent */}
      <div className="h-1 bg-gradient-to-r from-brand-400 to-brand-600" />

      <div className="p-5">
        {/* Icon + name */}
        <div className="flex items-start gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center shrink-0">
            <FileText className="w-5 h-5 text-brand-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-bold text-ink-900 truncate">{name}</p>
            <p className="text-[11.5px] text-ink-400 truncate mt-0.5">{altName}</p>
          </div>
          <StatusBadge status={template.status} />
        </div>

        {/* Description */}
        {template.description && (
          <p className="text-[12px] text-ink-500 line-clamp-2 mb-3">
            {template.description}
          </p>
        )}

        {/* Stats row */}
        <div className="flex items-center gap-4 pt-3 border-t border-ink-50">
          <div className="flex items-center gap-1.5 text-[11.5px] text-ink-500">
            <Hash className="w-3.5 h-3.5 text-ink-400" />
            <span>
              {template.field_count} {t("templates.fieldsCount")}
            </span>
          </div>
          {template.usage_count > 0 && (
            <div className="flex items-center gap-1.5 text-[11.5px] text-ink-500">
              <Eye className="w-3.5 h-3.5 text-ink-400" />
              <span>
                {template.usage_count} {t("templates.usageCount")}
              </span>
            </div>
          )}

          {/* Action buttons — always visible on mobile, hover on desktop */}
          <div className="ms-auto flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(template); }}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-ink-400 hover:text-brand-600 hover:bg-brand-50 transition-all"
              title={t("common.edit")}
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(template); }}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-ink-400 hover:text-rose-600 hover:bg-rose-50 transition-all"
              title={t("common.delete")}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TemplatesPage() {
  const { t }   = useTranslation();
  const router  = useRouter();
  const { data: templates = [], isLoading } = useTemplates();

  const [search,    setSearch]    = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editing,   setEditing]   = useState<TemplateListItem | null>(null);
  const [deleting,  setDeleting]  = useState<TemplateListItem | null>(null);

  // Filter
  const filtered = templates.filter((tmpl) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      tmpl.name_ar.toLowerCase().includes(q) ||
      tmpl.name_en.toLowerCase().includes(q) ||
      (tmpl.description ?? "").toLowerCase().includes(q)
    );
  });

  function openEdit(tmpl: TemplateListItem) {
    setEditing(tmpl);
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditing(null);
  }

  function handleCreate(id: string) {
    router.push(`/templates/${id}`);
  }

  return (
    <div className="px-4 sm:px-6 py-6 max-w-6xl mx-auto">

      {/* Page header */}
      <div className="flex items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-[22px] font-extrabold text-ink-900">
            {t("templates.title")}
          </h1>
          <p className="text-[13px] text-ink-500 mt-0.5">
            {t("templates.subtitle")}
          </p>
        </div>
        <button
          onClick={() => { setEditing(null); setShowModal(true); }}
          className="flex items-center gap-2 h-10 px-4 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-[13.5px] font-semibold shadow-pop transition-all shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">{t("templates.add")}</span>
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-5">
        <Search className="absolute start-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400 pointer-events-none" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("templates.searchPlaceholder")}
          className="w-full h-10 ps-10 pe-4 rounded-xl border border-ink-200 bg-white text-[13px] text-ink-800 placeholder:text-ink-400 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-50 transition-all"
        />
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-44 rounded-2xl bg-ink-100 animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-ink-100 flex items-center justify-center mb-4">
            <LayoutGrid className="w-7 h-7 text-ink-400" />
          </div>
          <p className="text-[15px] font-bold text-ink-700">
            {search ? t("common.noResults") : t("templates.empty")}
          </p>
          <p className="text-[12.5px] text-ink-400 mt-1 max-w-xs">
            {search ? t("templates.emptySearch") : t("templates.emptyHint")}
          </p>
          {!search && (
            <button
              onClick={() => { setEditing(null); setShowModal(true); }}
              className="mt-5 flex items-center gap-2 h-10 px-5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-[13.5px] font-semibold shadow-pop transition-all"
            >
              <Plus className="w-4 h-4" />
              {t("templates.add")}
            </button>
          )}
        </div>
      )}

      {/* Grid */}
      {!isLoading && filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((tmpl) => (
            <TemplateCard
              key={tmpl.id}
              template={tmpl}
              onEdit={openEdit}
              onDelete={setDeleting}
              onOpen={(id) => router.push(`/templates/${id}`)}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {showModal && (
        <TemplateModal
          template={editing}
          onClose={closeModal}
          onCreate={handleCreate}
        />
      )}

      {deleting && (
        <DeleteTemplateModal
          template={deleting}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
