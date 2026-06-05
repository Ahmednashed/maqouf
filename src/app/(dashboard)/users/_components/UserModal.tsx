"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  X,
  User,
  Mail,
  Hash,
  MapPin,
  Palette,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useTranslation, type TranslationFn } from "@/hooks/use-translation";
import { useInviteUser, useUpdateUser } from "@/hooks/use-users";
import type { CompanyUserWithProfile } from "@/services/company-users";
import type { UserRole } from "@/types";

// ─── Preset colour palette ────────────────────────────────────────────────────
const PRESET_COLORS = [
  "#6366F1", "#8B5CF6", "#EC4899", "#EF4444",
  "#F97316", "#F59E0B", "#10B981", "#3B82F6",
  "#0EA5E9", "#111827",
];

// ─── Zod schema ───────────────────────────────────────────────────────────────
const createSchema = z.object({
  email:  z.string().email("يرجى إدخال بريد إلكتروني صحيح"),
  role:   z.enum(["owner", "admin", "merchandiser"] as const),
  color:  z.string().default("#6366F1"),
  emp_id: z.string().optional(),
  region: z.string().optional(),
});

const editSchema = z.object({
  role:   z.enum(["owner", "admin", "merchandiser"] as const),
  color:  z.string().default("#6366F1"),
  emp_id: z.string().optional(),
  region: z.string().optional(),
  status: z.enum(["active", "inactive"]).default("active"),
});

type CreateFormData = z.infer<typeof createSchema>;
type EditFormData   = z.infer<typeof editSchema>;

// ─── Props ────────────────────────────────────────────────────────────────────
interface UserModalProps {
  user?:    CompanyUserWithProfile | null;
  onClose:  () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────
export function UserModal({ user, onClose }: UserModalProps) {
  const { t }     = useTranslation();
  const isEdit    = Boolean(user);
  const create    = useInviteUser();
  const update    = useUpdateUser();
  const isPending = create.isPending || update.isPending;

  // ── Create form ─────────────────────────────────────────────────────────────
  const createForm = useForm<CreateFormData>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      email:  "",
      role:   "merchandiser",
      color:  "#6366F1",
      emp_id: "",
      region: "",
    },
  });

  // ── Edit form ───────────────────────────────────────────────────────────────
  const editForm = useForm<EditFormData>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      role:   (user?.role ?? "merchandiser") as UserRole,
      color:  user?.color  ?? "#6366F1",
      emp_id: user?.emp_id ?? "",
      region: user?.region ?? "",
      status: (user?.status ?? "active") as "active" | "inactive",
    },
  });

  // Re-populate edit form when user prop changes
  useEffect(() => {
    if (user) {
      editForm.reset({
        role:   user.role,
        color:  user.color  ?? "#6366F1",
        emp_id: user.emp_id ?? "",
        region: user.region ?? "",
        status: user.status,
      });
    }
  }, [user, editForm]);

  // ── Watched values ──────────────────────────────────────────────────────────
  const createColor  = createForm.watch("color");
  const editColor    = editForm.watch("color");
  const editStatus   = editForm.watch("status");
  const selectedColor = isEdit ? editColor : createColor;

  // ── Submit ──────────────────────────────────────────────────────────────────
  async function onSubmitCreate(data: CreateFormData) {
    await create.mutateAsync({
      email:  data.email,
      role:   data.role,
      color:  data.color,
      emp_id: data.emp_id || undefined,
      region: data.region || undefined,
    });
    onClose();
  }

  async function onSubmitEdit(data: EditFormData) {
    if (!user) return;
    await update.mutateAsync({
      id: user.id,
      payload: {
        role:   data.role,
        color:  data.color,
        emp_id: data.emp_id || undefined,
        region: data.region || undefined,
        status: data.status,
      },
    });
    onClose();
  }

  // ── Input class helper ──────────────────────────────────────────────────────
  const inputCls = (hasError?: boolean) =>
    cn(
      "w-full h-11 ps-10 pe-4 rounded-xl border bg-white text-[13px] outline-none transition-all",
      "placeholder:text-ink-300",
      "focus:border-brand-500 focus:ring-2 focus:ring-brand-50",
      hasError ? "border-rose-400 bg-rose-50/30" : "border-ink-200"
    );

  const selectCls = (hasError?: boolean) =>
    cn(
      "w-full h-11 ps-10 pe-4 rounded-xl border bg-white text-[13px] outline-none transition-all appearance-none",
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

      {/* Panel */}
      <div
        className="relative w-full max-w-lg bg-white rounded-2xl shadow-modal border border-ink-100 animate-slide-up max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-ink-100 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: selectedColor + "22" }}
            >
              <User className="w-4 h-4" style={{ color: selectedColor }} />
            </div>
            <h2 className="text-[16px] font-bold text-ink-900">
              {isEdit ? t("users.edit") : t("users.inviteTitle")}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-400 hover:text-ink-700 hover:bg-ink-100 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── CREATE FORM ─────────────────────────────────────────────────── */}
        {!isEdit && (
          <form
            onSubmit={createForm.handleSubmit(onSubmitCreate)}
            className="px-6 py-5 space-y-5"
          >
            {/* ── Section: Account Info ───────────────────────────────────── */}
            <div>
              <p className="text-[11px] font-bold text-ink-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                {t("users.sectionProfile")}
              </p>
              <div className="space-y-4">

                {/* Email */}
                <div>
                  <label className="block text-[12.5px] font-semibold text-ink-700 mb-1.5">
                    {t("users.emailField")} <span className="text-brand-500">*</span>
                  </label>
                  <div className="relative">
                    <Mail className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400 pointer-events-none" />
                    <input
                      {...createForm.register("email")}
                      type="email"
                      dir="ltr"
                      autoComplete="off"
                      placeholder={t("users.emailPlaceholder")}
                      className={inputCls(!!createForm.formState.errors.email)}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-ink-400">
                    {t("users.emailHint")}
                  </p>
                  {createForm.formState.errors.email && (
                    <p className="mt-0.5 text-[11.5px] text-rose-500">
                      {createForm.formState.errors.email.message}
                    </p>
                  )}
                </div>

                {/* Role */}
                <div>
                  <label className="block text-[12.5px] font-semibold text-ink-700 mb-1.5">
                    {t("users.role")} <span className="text-brand-500">*</span>
                  </label>
                  <div className="relative">
                    <ShieldCheck className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400 pointer-events-none" />
                    <select
                      {...createForm.register("role")}
                      className={selectCls(!!createForm.formState.errors.role)}
                    >
                      <option value="merchandiser">{t("role.merchandiser")}</option>
                      <option value="admin">{t("role.admin")}</option>
                      <option value="owner">{t("role.owner")}</option>
                    </select>
                  </div>
                </div>

              </div>
            </div>

            {/* ── Section: Job Details ────────────────────────────────────── */}
            <div>
              <p className="text-[11px] font-bold text-ink-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5" />
                {t("users.sectionDetails")}
              </p>
              <div className="space-y-4">

                {/* Emp ID + Region row */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[12.5px] font-semibold text-ink-700 mb-1.5">
                      {t("users.empId")}
                    </label>
                    <div className="relative">
                      <Hash className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400 pointer-events-none" />
                      <input
                        {...createForm.register("emp_id")}
                        dir="ltr"
                        placeholder={t("users.empIdPlaceholder")}
                        className={inputCls(false)}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[12.5px] font-semibold text-ink-700 mb-1.5">
                      {t("users.region")}
                    </label>
                    <div className="relative">
                      <MapPin className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400 pointer-events-none" />
                      <input
                        {...createForm.register("region")}
                        placeholder={t("users.regionPlaceholder")}
                        className={inputCls(false)}
                      />
                    </div>
                  </div>
                </div>

                {/* Color picker */}
                <ColorPicker
                  t={t}
                  selected={createColor}
                  onChange={(c) => createForm.setValue("color", c)}
                />

              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 h-11 rounded-xl border border-ink-200 text-ink-700 text-[13.5px] font-semibold hover:bg-ink-50 transition-all"
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="flex-1 h-11 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white text-[13.5px] font-semibold shadow-pop transition-all"
              >
                {isPending ? t("common.loading") : t("users.sendInvite")}
              </button>
            </div>
          </form>
        )}

        {/* ── EDIT FORM ────────────────────────────────────────────────────── */}
        {isEdit && user && (
          <form
            onSubmit={editForm.handleSubmit(onSubmitEdit)}
            className="px-6 py-5 space-y-5"
          >
            {/* User identity banner */}
            <div className="flex items-center gap-3 p-3.5 rounded-xl bg-ink-50 border border-ink-100">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-[14px] shrink-0"
                style={{ backgroundColor: editColor }}
              >
                {user.user.full_name?.charAt(0)?.toUpperCase() ?? "?"}
              </div>
              <div>
                <p className="text-[13.5px] font-semibold text-ink-800 leading-tight">
                  {user.user.full_name}
                </p>
                <p className="text-[12px] text-ink-400 leading-tight" dir="ltr">
                  {user.user.email}
                </p>
              </div>
            </div>

            {/* ── Section: Account Info ───────────────────────────────────── */}
            <div>
              <p className="text-[11px] font-bold text-ink-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                {t("users.sectionProfile")}
              </p>

              {/* Role */}
              <div>
                <label className="block text-[12.5px] font-semibold text-ink-700 mb-1.5">
                  {t("users.role")} <span className="text-brand-500">*</span>
                </label>
                <div className="relative">
                  <ShieldCheck className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400 pointer-events-none" />
                  <select
                    {...editForm.register("role")}
                    className={selectCls(!!editForm.formState.errors.role)}
                  >
                    <option value="merchandiser">{t("role.merchandiser")}</option>
                    <option value="admin">{t("role.admin")}</option>
                    <option value="owner">{t("role.owner")}</option>
                  </select>
                </div>
              </div>
            </div>

            {/* ── Section: Job Details ────────────────────────────────────── */}
            <div>
              <p className="text-[11px] font-bold text-ink-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5" />
                {t("users.sectionDetails")}
              </p>
              <div className="space-y-4">

                {/* Emp ID + Region */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[12.5px] font-semibold text-ink-700 mb-1.5">
                      {t("users.empId")}
                    </label>
                    <div className="relative">
                      <Hash className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400 pointer-events-none" />
                      <input
                        {...editForm.register("emp_id")}
                        dir="ltr"
                        placeholder={t("users.empIdPlaceholder")}
                        className={inputCls(false)}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[12.5px] font-semibold text-ink-700 mb-1.5">
                      {t("users.region")}
                    </label>
                    <div className="relative">
                      <MapPin className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400 pointer-events-none" />
                      <input
                        {...editForm.register("region")}
                        placeholder={t("users.regionPlaceholder")}
                        className={inputCls(false)}
                      />
                    </div>
                  </div>
                </div>

                {/* Color picker */}
                <ColorPicker
                  t={t}
                  selected={editColor}
                  onChange={(c) => editForm.setValue("color", c)}
                />

                {/* Status toggle */}
                <div className="flex items-center justify-between py-2.5 px-3.5 rounded-xl bg-ink-50 border border-ink-100">
                  <span className="text-[13px] font-medium text-ink-700">
                    {t("common.status")}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      editForm.setValue(
                        "status",
                        editStatus === "active" ? "inactive" : "active"
                      )
                    }
                    className={cn(
                      "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                      editStatus === "active" ? "bg-brand-500" : "bg-ink-200"
                    )}
                  >
                    <span
                      className={cn(
                        "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
                        editStatus === "active" ? "translate-x-6" : "translate-x-1"
                      )}
                    />
                  </button>
                </div>

              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 h-11 rounded-xl border border-ink-200 text-ink-700 text-[13.5px] font-semibold hover:bg-ink-50 transition-all"
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="flex-1 h-11 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white text-[13.5px] font-semibold shadow-pop transition-all"
              >
                {isPending ? t("common.loading") : t("common.save")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Colour picker sub-component ─────────────────────────────────────────────
function ColorPicker({
  t,
  selected,
  onChange,
}: {
  t:        TranslationFn;
  selected: string;
  onChange: (c: string) => void;
}) {
  return (
    <div>
      <label className="block text-[12.5px] font-semibold text-ink-700 mb-2">
        <Palette className="inline w-3.5 h-3.5 me-1 text-ink-400" />
        {t("users.color")}
      </label>
      <div className="flex flex-wrap gap-2">
        {PRESET_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            title={c}
            onClick={() => onChange(c)}
            className={cn(
              "w-7 h-7 rounded-lg border-2 transition-all",
              selected === c
                ? "border-ink-900 scale-110 shadow-pop"
                : "border-transparent hover:scale-105"
            )}
            style={{ backgroundColor: c }}
          />
        ))}
        {/* Custom hex via native colour picker */}
        <div className="relative flex items-center">
          <span
            className="w-7 h-7 rounded-lg border-2 border-ink-200 cursor-pointer"
            style={{ backgroundColor: selected }}
          />
          <input
            type="color"
            value={selected}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 opacity-0 w-7 h-7 cursor-pointer"
            title="Custom color"
          />
        </div>
      </div>
    </div>
  );
}
