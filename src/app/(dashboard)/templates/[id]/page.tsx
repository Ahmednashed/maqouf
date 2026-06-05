"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowRight, ArrowLeft, Plus, Pencil, Trash2, Eye, List,
  ChevronUp, ChevronDown, ToggleLeft, ToggleRight, Loader2,
  FileText, Hash, Type, CircleDot, CheckSquare, Camera,
  CalendarDays, ScanLine, AlignLeft, MapPin, AlertCircle,
} from "lucide-react";
import { useTranslation }  from "@/hooks/use-translation";
import {
  useTemplate,
  useUpdateTemplate,
  useDeleteField,
  useReorderFields,
} from "@/hooks/use-templates";
import { FieldEditorModal }    from "../_components/FieldEditorModal";
import { PreviewPanel }        from "../_components/PreviewPanel";
import { DeleteTemplateModal } from "../_components/DeleteTemplateModal";
import { TemplateModal }       from "../_components/TemplateModal";
import type { FieldType, TemplateFieldFull, TemplateListItem } from "@/types";
import type { TranslationKey } from "@/lib/i18n/translations";

// ─── Field type label key map ─────────────────────────────────────────────────
// Maps each FieldType that has a "templates.fieldType_X" translation to that key.
// Types without a translation (photos, product, matrix) are absent — callers fall
// back to the raw type string.

const FIELD_TYPE_LABEL: Partial<Record<FieldType, TranslationKey>> = {
  text:     "templates.fieldType_text",
  numeric:  "templates.fieldType_numeric",
  yesno:    "templates.fieldType_yesno",
  single:   "templates.fieldType_single",
  multiple: "templates.fieldType_multiple",
  photo:    "templates.fieldType_photo",
  date:     "templates.fieldType_date",
  barcode:  "templates.fieldType_barcode",
  section:  "templates.fieldType_section",
  location: "templates.fieldType_location",
};

// ─── Field type icon map ──────────────────────────────────────────────────────

const TYPE_ICONS: Record<string, { Icon: React.ElementType; color: string; bg: string }> = {
  text:     { Icon: Type,         color: "#6366F1", bg: "#EEF2FF" },
  numeric:  { Icon: Hash,         color: "#0EA5E9", bg: "#E0F2FE" },
  yesno:    { Icon: ToggleLeft,   color: "#10B981", bg: "#D1FAE5" },
  single:   { Icon: CircleDot,    color: "#8B5CF6", bg: "#EDE9FE" },
  multiple: { Icon: CheckSquare,  color: "#F59E0B", bg: "#FEF3C7" },
  photo:    { Icon: Camera,       color: "#EC4899", bg: "#FCE7F3" },
  date:     { Icon: CalendarDays, color: "#14B8A6", bg: "#CCFBF1" },
  barcode:  { Icon: ScanLine,     color: "#F97316", bg: "#FFEDD5" },
  section:  { Icon: AlignLeft,    color: "#6B7280", bg: "#F3F4F6" },
  location: { Icon: MapPin,       color: "#EF4444", bg: "#FEE2E2" },
};

// ─── Field row ────────────────────────────────────────────────────────────────

interface FieldRowProps {
  field:    TemplateFieldFull;
  index:    number;
  total:    number;
  onEdit:   (f: TemplateFieldFull) => void;
  onDelete: (f: TemplateFieldFull) => void;
  onMoveUp:   () => void;
  onMoveDown: () => void;
}

function FieldRow({ field, index, total, onEdit, onDelete, onMoveUp, onMoveDown }: FieldRowProps) {
  const { t, locale } = useTranslation();
  const meta   = TYPE_ICONS[field.type] ?? TYPE_ICONS.text;
  const { Icon, color, bg } = meta;
  const label  = locale === "ar" ? field.label_ar : field.label_en;
  const labelKey = FIELD_TYPE_LABEL[field.type];
  const typeLbl  = labelKey ? t(labelKey) : field.type;

  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-white rounded-xl border border-ink-100 shadow-sm hover:border-brand-200 transition-all group">
      {/* Reorder buttons */}
      <div className="flex flex-col gap-0.5">
        <button
          onClick={onMoveUp}
          disabled={index === 0}
          className="w-6 h-6 rounded-md flex items-center justify-center text-ink-300 hover:text-ink-600 hover:bg-ink-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
        >
          <ChevronUp className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onMoveDown}
          disabled={index === total - 1}
          className="w-6 h-6 rounded-md flex items-center justify-center text-ink-300 hover:text-ink-600 hover:bg-ink-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Type icon */}
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: bg }}
      >
        <Icon className="w-4 h-4" style={{ color }} />
      </div>

      {/* Label + type */}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-ink-800 truncate">
          {label || <span className="text-ink-300 italic">{t("templates.noLabel")}</span>}
          {field.required && <span className="text-rose-500 ms-1">*</span>}
        </p>
        <p className="text-[11px] text-ink-400">{typeLbl}</p>
      </div>

      {/* Options chip */}
      {field.options && field.options.length > 0 && (
        <span className="hidden sm:inline text-[10.5px] text-ink-500 bg-ink-50 border border-ink-100 rounded-full px-2 py-0.5 shrink-0">
          {field.options.length} {t("templates.options")}
        </span>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => onEdit(field)}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-ink-400 hover:text-brand-600 hover:bg-brand-50 transition-all"
          title={t("common.edit")}
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onDelete(field)}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-ink-400 hover:text-rose-600 hover:bg-rose-50 transition-all"
          title={t("common.delete")}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Delete field confirm (inline micro-modal) ────────────────────────────────

interface DeleteFieldConfirmProps {
  field:    TemplateFieldFull;
  onCancel: () => void;
  onConfirm: () => void;
  pending:  boolean;
}

function DeleteFieldConfirm({ field, onCancel, onConfirm, pending }: DeleteFieldConfirmProps) {
  const { t, locale } = useTranslation();
  const label = locale === "ar" ? field.label_ar : field.label_en;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-sm bg-white rounded-2xl shadow-modal border border-ink-100 p-6 space-y-4 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-rose-50 flex items-center justify-center">
            <Trash2 className="w-4.5 h-4.5 text-rose-500" />
          </div>
          <div>
            <p className="text-[14px] font-bold text-ink-900">{t("templates.deleteField")}</p>
            <p className="text-[12px] text-ink-500 truncate max-w-[180px]">{label}</p>
          </div>
        </div>
        <p className="text-[12.5px] text-ink-600">{t("templates.deleteFieldWarning")}</p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={pending}
            className="flex-1 h-10 rounded-xl border border-ink-200 text-ink-700 text-[13px] font-semibold hover:bg-ink-50 disabled:opacity-60 transition-all"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={onConfirm}
            disabled={pending}
            className="flex-1 h-10 rounded-xl bg-rose-500 hover:bg-rose-600 disabled:opacity-60 text-white text-[13px] font-semibold transition-all"
          >
            {pending ? t("common.loading") : t("common.delete")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Tab = "fields" | "preview";

export default function TemplateBuilderPage() {
  const { t, locale } = useTranslation();
  const router        = useRouter();
  const params        = useParams<{ id: string }>();
  const id            = params.id;

  const { data: template, isLoading, isError } = useTemplate(id);

  const updateTemplate = useUpdateTemplate();
  const deleteField    = useDeleteField(id);
  const reorderFields  = useReorderFields(id);

  // UI state
  const [tab,            setTab]            = useState<Tab>("fields");
  const [showFieldModal, setShowFieldModal] = useState(false);
  const [editingField,   setEditingField]   = useState<TemplateFieldFull | null>(null);
  const [deletingField,  setDeletingField]  = useState<TemplateFieldFull | null>(null);
  const [showEditMeta,   setShowEditMeta]   = useState(false);
  const [showDeleteTmpl, setShowDeleteTmpl] = useState(false);

  // ── Move field up/down ─────────────────────────────────────────────────────

  function moveField(index: number, direction: "up" | "down") {
    if (!template) return;
    const fields    = [...template.fields];
    const swapIdx   = direction === "up" ? index - 1 : index + 1;
    if (swapIdx < 0 || swapIdx >= fields.length) return;

    // Swap sort_order values
    const updates = [
      { id: fields[index].id,   sort_order: fields[swapIdx].sort_order },
      { id: fields[swapIdx].id, sort_order: fields[index].sort_order   },
    ];
    reorderFields.mutate(updates);
  }

  // ── Status toggle ──────────────────────────────────────────────────────────

  function toggleStatus() {
    if (!template) return;
    const next = template.status === "active" ? "draft" : "active";
    updateTemplate.mutate({ id, payload: { status: next } });
  }

  // ── Delete field ───────────────────────────────────────────────────────────

  async function confirmDeleteField() {
    if (!deletingField) return;
    await deleteField.mutateAsync(deletingField.id);
    setDeletingField(null);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Loading / Error states
  // ─────────────────────────────────────────────────────────────────────────

  const BackIcon  = locale === "ar" ? ArrowRight : ArrowLeft;
  const backHref  = "/templates";

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
      </div>
    );
  }

  if (isError || !template) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-3 px-4">
        <AlertCircle className="w-10 h-10 text-rose-400" />
        <p className="text-[15px] font-bold text-ink-800">{t("common.errorLoad")}</p>
        <button
          onClick={() => router.push(backHref)}
          className="mt-2 px-4 h-10 rounded-xl bg-brand-500 text-white text-[13.5px] font-semibold hover:bg-brand-600 transition-all"
        >
          {t("common.back")}
        </button>
      </div>
    );
  }

  const fields    = template.fields;
  const tmplName  = locale === "ar" ? template.name_ar : template.name_en;
  const isActive  = template.status === "active";

  // Cast to TemplateListItem shape for DeleteTemplateModal / TemplateModal
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { fields: _fields, ...tmplBase } = template;
  const tmplListItem: TemplateListItem = { ...tmplBase, field_count: fields.length };

  return (
    <div className="flex flex-col min-h-screen bg-surface">

      {/* ── Sticky header ───────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 bg-white border-b border-ink-100 px-4 sm:px-6 py-3.5 flex items-center gap-3">
        {/* Back */}
        <button
          onClick={() => router.push(backHref)}
          className="w-9 h-9 rounded-xl flex items-center justify-center text-ink-500 hover:text-ink-900 hover:bg-ink-100 transition-all shrink-0"
        >
          <BackIcon className="w-4.5 h-4.5" />
        </button>

        {/* Name + edit */}
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-brand-50 flex items-center justify-center shrink-0">
            <FileText className="w-3.5 h-3.5 text-brand-500" />
          </div>
          <p className="text-[14.5px] font-bold text-ink-900 truncate">{tmplName}</p>
          <button
            onClick={() => setShowEditMeta(true)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-ink-400 hover:text-brand-600 hover:bg-brand-50 transition-all shrink-0"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Status toggle */}
        <button
          onClick={toggleStatus}
          disabled={updateTemplate.isPending}
          className={`
            flex items-center gap-1.5 px-3 h-8 rounded-full text-[11.5px] font-semibold border transition-all
            ${isActive
              ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
              : "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100"}
          `}
          title={t("templates.toggleStatus")}
        >
          {isActive
            ? <ToggleRight className="w-4 h-4" />
            : <ToggleLeft  className="w-4 h-4" />}
          <span className="hidden sm:inline">
            {isActive ? t("templates.statusActive") : t("templates.statusDraft")}
          </span>
        </button>

        {/* Delete template */}
        <button
          onClick={() => setShowDeleteTmpl(true)}
          className="w-8 h-8 rounded-xl flex items-center justify-center text-ink-400 hover:text-rose-600 hover:bg-rose-50 transition-all shrink-0"
          title={t("common.delete")}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </header>

      {/* ── Mobile tab toggle ────────────────────────────────────────────────── */}
      <div className="lg:hidden sticky top-[57px] z-20 bg-white border-b border-ink-100 px-4 py-2 flex gap-2">
        <button
          onClick={() => setTab("fields")}
          className={`flex-1 h-9 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-1.5 transition-all ${
            tab === "fields"
              ? "bg-brand-500 text-white shadow-pop"
              : "text-ink-600 hover:bg-ink-100"
          }`}
        >
          <List className="w-3.5 h-3.5" />
          {t("templates.tabFields")} ({fields.length})
        </button>
        <button
          onClick={() => setTab("preview")}
          className={`flex-1 h-9 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-1.5 transition-all ${
            tab === "preview"
              ? "bg-brand-500 text-white shadow-pop"
              : "text-ink-600 hover:bg-ink-100"
          }`}
        >
          <Eye className="w-3.5 h-3.5" />
          {t("templates.tabPreview")}
        </button>
      </div>

      {/* ── Main content ─────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col lg:flex-row gap-0 lg:gap-6 px-4 sm:px-6 py-5 max-w-6xl mx-auto w-full">

        {/* ── Field list (left / mobile tab) ──────────────────────────────────── */}
        <div className={`flex-1 min-w-0 ${tab !== "fields" ? "hidden lg:flex lg:flex-col" : "flex flex-col"}`}>

          {/* Add field button */}
          <button
            onClick={() => { setEditingField(null); setShowFieldModal(true); }}
            className="w-full h-11 mb-4 rounded-xl border-2 border-dashed border-brand-300 text-brand-600 text-[13.5px] font-semibold flex items-center justify-center gap-2 hover:border-brand-400 hover:bg-brand-50 transition-all"
          >
            <Plus className="w-4 h-4" />
            {t("templates.addField")}
          </button>

          {/* Empty field list */}
          {fields.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-14 h-14 rounded-2xl bg-ink-100 flex items-center justify-center mb-3">
                <Hash className="w-6 h-6 text-ink-400" />
              </div>
              <p className="text-[13.5px] font-semibold text-ink-600">
                {t("templates.fieldsEmpty")}
              </p>
              <p className="text-[12px] text-ink-400 mt-1">
                {t("templates.fieldsEmptyHint")}
              </p>
            </div>
          )}

          {/* Field rows */}
          <div className="space-y-2">
            {fields.map((field, i) => (
              <FieldRow
                key={field.id}
                field={field}
                index={i}
                total={fields.length}
                onEdit={(f) => { setEditingField(f); setShowFieldModal(true); }}
                onDelete={setDeletingField}
                onMoveUp={() => moveField(i, "up")}
                onMoveDown={() => moveField(i, "down")}
              />
            ))}
          </div>
        </div>

        {/* ── Preview panel (right / mobile tab) ──────────────────────────────── */}
        <div className={`lg:w-[340px] xl:w-[380px] shrink-0 ${tab !== "preview" ? "hidden lg:block" : "block"}`}>
          <div className="sticky top-[130px]">
            {/* Panel shell — phone mockup feel */}
            <div className="bg-white rounded-2xl border border-ink-100 shadow-card overflow-hidden">
              {/* Mock phone topbar */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-ink-100 bg-ink-50">
                <div className="flex items-center gap-2">
                  <Eye className="w-4 h-4 text-ink-400" />
                  <span className="text-[12px] font-semibold text-ink-500">
                    {t("templates.previewTitle")}
                  </span>
                </div>
                <div className="flex gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-ink-300" />
                  <div className="w-1.5 h-1.5 rounded-full bg-ink-200" />
                  <div className="w-1.5 h-1.5 rounded-full bg-ink-200" />
                </div>
              </div>

              {/* Scrollable preview */}
              <div className="max-h-[60vh] overflow-y-auto p-4">
                <PreviewPanel fields={fields} />
              </div>
            </div>

            {/* Field count chip */}
            <p className="text-center text-[11.5px] text-ink-400 mt-2.5">
              {fields.length} {t("templates.fieldsCount")}
            </p>
          </div>
        </div>
      </div>

      {/* ── Modals ──────────────────────────────────────────────────────────────── */}

      {showFieldModal && (
        <FieldEditorModal
          templateId={id}
          field={editingField}
          onClose={() => { setShowFieldModal(false); setEditingField(null); }}
        />
      )}

      {deletingField && (
        <DeleteFieldConfirm
          field={deletingField}
          onCancel={() => setDeletingField(null)}
          onConfirm={confirmDeleteField}
          pending={deleteField.isPending}
        />
      )}

      {showEditMeta && (
        <TemplateModal
          template={tmplListItem}
          onClose={() => setShowEditMeta(false)}
        />
      )}

      {showDeleteTmpl && (
        <DeleteTemplateModal
          template={tmplListItem}
          onClose={() => {
            setShowDeleteTmpl(false);
            router.push(backHref);
          }}
        />
      )}
    </div>
  );
}
