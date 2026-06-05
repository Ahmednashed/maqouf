"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  X, Type, Hash, ToggleLeft, CircleDot, CheckSquare,
  Camera, CalendarDays, ScanLine, AlignLeft, MapPin,
  Plus, Trash2, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/hooks/use-translation";
import { useCreateField, useUpdateField } from "@/hooks/use-templates";
import type { FieldType, TemplateFieldFull } from "@/types";

// ─── Field type catalogue ─────────────────────────────────────────────────────

// The subset of FieldType values that the editor supports and that have
// corresponding "templates.type.X" entries in the translation file.
type FieldEditorType =
  | "text" | "numeric" | "yesno" | "single" | "multiple"
  | "photo" | "date" | "barcode" | "section" | "location";

type FieldTypeMeta = {
  type:       FieldEditorType;
  Icon:       React.ElementType;
  color:      string;
  bgColor:    string;
};

const FIELD_TYPES: FieldTypeMeta[] = [
  { type: "text",     Icon: Type,         color: "#6366F1", bgColor: "#EEF2FF" },
  { type: "numeric",  Icon: Hash,         color: "#0EA5E9", bgColor: "#E0F2FE" },
  { type: "yesno",    Icon: ToggleLeft,   color: "#10B981", bgColor: "#D1FAE5" },
  { type: "single",   Icon: CircleDot,    color: "#8B5CF6", bgColor: "#EDE9FE" },
  { type: "multiple", Icon: CheckSquare,  color: "#F59E0B", bgColor: "#FEF3C7" },
  { type: "photo",    Icon: Camera,       color: "#EC4899", bgColor: "#FCE7F3" },
  { type: "date",     Icon: CalendarDays, color: "#14B8A6", bgColor: "#CCFBF1" },
  { type: "barcode",  Icon: ScanLine,     color: "#F97316", bgColor: "#FFEDD5" },
  { type: "section",  Icon: AlignLeft,    color: "#6B7280", bgColor: "#F3F4F6" },
  { type: "location", Icon: MapPin,       color: "#EF4444", bgColor: "#FEE2E2" },
];

const TYPES_WITH_OPTIONS: FieldType[] = ["single", "multiple"];

// ─── Schema ───────────────────────────────────────────────────────────────────

const schema = z.object({
  type:          z.string().min(1),
  label_ar:      z.string().min(1, "الاسم العربي مطلوب"),
  label_en:      z.string().min(1, "English label is required"),
  required:      z.boolean().default(false),
  help_text_ar:  z.string().optional(),
  help_text_en:  z.string().optional(),
});

type FormData = z.infer<typeof schema>;

// ─── Props ────────────────────────────────────────────────────────────────────

interface FieldEditorModalProps {
  templateId:   string;
  /** When provided the modal is in edit mode */
  field?:       TemplateFieldFull | null;
  /** Pre-select a type when opening for a new field */
  initialType?: FieldType;
  onClose:      () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FieldEditorModal({
  templateId,
  field,
  initialType = "text",
  onClose,
}: FieldEditorModalProps) {
  const { t, locale } = useTranslation();
  const isEdit        = Boolean(field);
  const createField   = useCreateField(templateId);
  const updateField   = useUpdateField(templateId);
  const pending       = createField.isPending || updateField.isPending;

  // ── Selected type (tracked outside RHF for the type grid) ──────────────────
  const [selectedType, setSelectedType] = useState<FieldType>(
    field?.type ?? initialType
  );

  // ── Options state (for single / multiple choice) ────────────────────────────
  const [options, setOptions]     = useState<string[]>(field?.options ?? []);
  const [optionInput, setOptionInput] = useState("");

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } =
    useForm<FormData>({
      resolver: zodResolver(schema),
      defaultValues: {
        type:         field?.type      ?? initialType,
        label_ar:     field?.label_ar  ?? "",
        label_en:     field?.label_en  ?? "",
        required:     field?.required  ?? false,
        help_text_ar: field?.help_text_ar ?? "",
        help_text_en: field?.help_text_en ?? "",
      },
    });

  const isRequired     = watch("required");
  const needsOptions   = TYPES_WITH_OPTIONS.includes(selectedType);
  const [showHelp, setShowHelp] = useState(
    Boolean(field?.help_text_ar || field?.help_text_en)
  );

  useEffect(() => {
    if (field) {
      setSelectedType(field.type);
      setOptions(field.options ?? []);
      reset({
        type:         field.type,
        label_ar:     field.label_ar,
        label_en:     field.label_en,
        required:     field.required,
        help_text_ar: field.help_text_ar ?? "",
        help_text_en: field.help_text_en ?? "",
      });
    }
  }, [field, reset]);

  // ── Option helpers ──────────────────────────────────────────────────────────

  function addOption() {
    const val = optionInput.trim();
    if (!val || options.includes(val)) return;
    setOptions((prev) => [...prev, val]);
    setOptionInput("");
  }

  function removeOption(opt: string) {
    setOptions((prev) => prev.filter((o) => o !== opt));
  }

  // ── Submit ──────────────────────────────────────────────────────────────────

  async function onSubmit(data: FormData) {
    const payload = {
      type:          selectedType,
      label_ar:      data.label_ar,
      label_en:      data.label_en,
      required:      data.required,
      options:       needsOptions ? options : null,
      help_text_ar:  data.help_text_ar || null,
      help_text_en:  data.help_text_en || null,
    };

    if (isEdit && field) {
      await updateField.mutateAsync({ id: field.id, payload });
    } else {
      await createField.mutateAsync(payload);
    }
    onClose();
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const inputCls = (hasError?: boolean) =>
    cn(
      "w-full h-11 px-4 rounded-xl border bg-white text-[13px] outline-none transition-all",
      "placeholder:text-ink-300",
      "focus:border-brand-500 focus:ring-2 focus:ring-brand-50",
      hasError ? "border-rose-400 bg-rose-50/30" : "border-ink-200"
    );

  const typeMeta = FIELD_TYPES.find((f) => f.type === selectedType);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm animate-fade-in" />

      <div
        className="relative w-full max-w-lg bg-white rounded-2xl shadow-modal border border-ink-100 animate-slide-up max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-ink-100 shrink-0">
          <div className="flex items-center gap-3">
            {typeMeta && (
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: typeMeta.bgColor }}
              >
                <typeMeta.Icon className="w-4 h-4" style={{ color: typeMeta.color }} />
              </div>
            )}
            <h2 className="text-[15px] font-bold text-ink-900">
              {isEdit ? t("templates.editField") : t("templates.addField")}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-400 hover:text-ink-700 hover:bg-ink-100 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1">
          <form id="field-form" onSubmit={handleSubmit(onSubmit)} className="px-6 py-5 space-y-5">

            {/* ── Type grid ────────────────────────────────────────────── */}
            <div>
              <p className="text-[11px] font-bold text-ink-400 uppercase tracking-widest mb-3">
                {t("templates.fieldType")}
              </p>
              <div className="grid grid-cols-5 gap-2">
                {FIELD_TYPES.map(({ type, Icon, color, bgColor }) => {
                  const isSelected = selectedType === type;
                  const typeKey    = `templates.type.${type}` as const;
                  return (
                    <button
                      key={type}
                      type="button"
                      title={t(typeKey)}
                      onClick={() => {
                        setSelectedType(type);
                        setValue("type", type);
                      }}
                      className={cn(
                        "flex flex-col items-center gap-1.5 p-2.5 rounded-xl border-2 transition-all",
                        isSelected
                          ? "border-current shadow-pop"
                          : "border-transparent hover:border-ink-200 hover:bg-ink-50"
                      )}
                      style={isSelected ? { borderColor: color, backgroundColor: bgColor } : {}}
                    >
                      <Icon className="w-4 h-4" style={{ color }} />
                      <span className="text-[10px] font-semibold text-ink-600 text-center leading-tight">
                        {t(typeKey)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Labels ───────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[12.5px] font-semibold text-ink-700 mb-1.5">
                  {t("templates.labelAr")} <span className="text-brand-500">*</span>
                </label>
                <input
                  {...register("label_ar")}
                  dir="rtl"
                  placeholder="مثال: الكمية"
                  className={inputCls(!!errors.label_ar)}
                />
                {errors.label_ar && (
                  <p className="mt-1 text-[11px] text-rose-500">{errors.label_ar.message}</p>
                )}
              </div>
              <div>
                <label className="block text-[12.5px] font-semibold text-ink-700 mb-1.5">
                  {t("templates.labelEn")} <span className="text-brand-500">*</span>
                </label>
                <input
                  {...register("label_en")}
                  dir="ltr"
                  placeholder="e.g. Quantity"
                  className={inputCls(!!errors.label_en)}
                />
                {errors.label_en && (
                  <p className="mt-1 text-[11px] text-rose-500">{errors.label_en.message}</p>
                )}
              </div>
            </div>

            {/* ── Required toggle ───────────────────────────────────────── */}
            <div className="flex items-center justify-between py-2.5 px-3.5 rounded-xl bg-ink-50 border border-ink-100">
              <span className="text-[13px] font-medium text-ink-700">
                {t("templates.required")}
              </span>
              <button
                type="button"
                onClick={() => setValue("required", !isRequired)}
                className={cn(
                  "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                  isRequired ? "bg-brand-500" : "bg-ink-200"
                )}
              >
                <span
                  className={cn(
                    "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
                    isRequired ? "translate-x-6" : "translate-x-1"
                  )}
                />
              </button>
            </div>

            {/* ── Options (choice fields only) ──────────────────────────── */}
            {needsOptions && (
              <div>
                <p className="text-[12.5px] font-semibold text-ink-700 mb-2">
                  {t("templates.options")}
                </p>

                {/* Existing options */}
                <div className="flex flex-wrap gap-2 mb-2 min-h-[28px]">
                  {options.map((opt) => (
                    <span
                      key={opt}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-50 text-brand-700 text-[12.5px] font-medium border border-brand-200"
                    >
                      {opt}
                      <button
                        type="button"
                        onClick={() => removeOption(opt)}
                        className="hover:text-rose-500 transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                  {options.length === 0 && (
                    <p className="text-[12px] text-ink-300 italic">
                      {t("templates.addOption")}…
                    </p>
                  )}
                </div>

                {/* Add option row */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={optionInput}
                    onChange={(e) => setOptionInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); addOption(); }
                    }}
                    placeholder={t("templates.optionPlaceholder")}
                    className="flex-1 h-9 px-3 rounded-lg border border-ink-200 text-[13px] outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-100 transition-all"
                  />
                  <button
                    type="button"
                    onClick={addOption}
                    className="h-9 px-3 rounded-lg bg-brand-500 hover:bg-brand-600 text-white transition-all flex items-center gap-1.5 text-[13px] font-semibold"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* ── Help text (collapsible) ───────────────────────────────── */}
            <div>
              <button
                type="button"
                onClick={() => setShowHelp((v) => !v)}
                className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-500 hover:text-ink-800 transition-colors"
              >
                <ChevronDown
                  className={cn("w-3.5 h-3.5 transition-transform", showHelp && "rotate-180")}
                />
                {t("templates.helpTextAr")} / {t("templates.helpTextEn")}
                <span className="text-[11px] font-normal text-ink-300">
                  ({t("common.optional")})
                </span>
              </button>

              {showHelp && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11.5px] font-semibold text-ink-500 mb-1.5">
                      {t("templates.helpTextAr")}
                    </label>
                    <input
                      {...register("help_text_ar")}
                      dir="rtl"
                      placeholder={t("templates.helpTextArPlaceholder")}
                      className={inputCls(false)}
                    />
                  </div>
                  <div>
                    <label className="block text-[11.5px] font-semibold text-ink-500 mb-1.5">
                      {t("templates.helpTextEn")}
                    </label>
                    <input
                      {...register("help_text_en")}
                      dir="ltr"
                      placeholder={t("templates.helpTextEnPlaceholder")}
                      className={inputCls(false)}
                    />
                  </div>
                </div>
              )}
            </div>

          </form>
        </div>

        {/* Footer — fixed inside the modal */}
        <div className="px-6 py-4 border-t border-ink-100 shrink-0">
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-11 rounded-xl border border-ink-200 text-ink-700 text-[13.5px] font-semibold hover:bg-ink-50 transition-all"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              form="field-form"
              disabled={pending}
              className="flex-1 h-11 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white text-[13.5px] font-semibold shadow-pop transition-all"
            >
              {pending ? t("common.loading") : t("common.save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
