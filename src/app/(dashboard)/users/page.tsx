"use client";

import { useState, useMemo } from "react";
import {
  Users,
  Plus,
  Search,
  Pencil,
  UserCheck,
  UserX,
  AlertCircle,
  ToggleRight,
  ToggleLeft,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useTranslation, type TranslationFn } from "@/hooks/use-translation";
import { useUsers } from "@/hooks/use-users";
import type { CompanyUserWithProfile } from "@/services/company-users";
import type { UserRole } from "@/types";
import { UserModal }   from "./_components/UserModal";
import { StatusModal } from "./_components/StatusModal";

// ─── Skeleton row ─────────────────────────────────────────────────────────────
function SkeletonRow() {
  return (
    <tr className="border-b border-ink-100">
      {[...Array(7)].map((_, i) => (
        <td key={i} className="px-4 py-3.5">
          <div className="h-4 rounded-md bg-ink-100 animate-pulse" style={{ width: `${60 + (i * 13) % 40}%` }} />
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
        <Users className="w-8 h-8 text-ink-300" />
      </div>
      <h3 className="text-[15px] font-semibold text-ink-700 mb-1">
        {t("users.emptyTitle")}
      </h3>
      <p className="text-[13px] text-ink-400 mb-6 max-w-xs">
        {t("users.emptyDesc")}
      </p>
      <button
        onClick={onAdd}
        className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-[13px] font-semibold shadow-pop transition-all"
      >
        <Plus className="w-4 h-4" />
        {t("users.add")}
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
function StatusBadge({ status, t }: { status: "active" | "inactive"; t: TranslationFn }) {
  const active = status === "active";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11.5px] font-semibold",
        active ? "bg-emerald-50 text-emerald-700" : "bg-ink-100 text-ink-500"
      )}
    >
      {active
        ? <ToggleRight className="w-3.5 h-3.5" />
        : <ToggleLeft  className="w-3.5 h-3.5" />}
      {active ? t("common.active") : t("common.inactive")}
    </span>
  );
}

// ─── Role badge ───────────────────────────────────────────────────────────────
const ROLE_COLORS: Record<UserRole, string> = {
  owner:       "bg-amber-50 text-amber-700",
  admin:       "bg-blue-50 text-blue-700",
  merchandiser:"bg-violet-50 text-violet-700",
};

function RoleBadge({ role, t }: { role: UserRole; t: TranslationFn }) {
  return (
    <span className={cn("inline-flex px-2.5 py-1 rounded-full text-[11.5px] font-semibold", ROLE_COLORS[role])}>
      {t(`role.${role}`)}
    </span>
  );
}

// ─── Table head ───────────────────────────────────────────────────────────────
function TableHead({ t }: { t: TranslationFn }) {
  return (
    <tr className="border-b border-ink-100 bg-ink-50/60">
      <th className="px-4 py-3 text-start text-[11.5px] font-semibold text-ink-400 uppercase tracking-wide">
        {t("users.colName")}
      </th>
      <th className="px-4 py-3 text-start text-[11.5px] font-semibold text-ink-400 uppercase tracking-wide">
        {t("users.colEmail")}
      </th>
      <th className="px-4 py-3 text-start text-[11.5px] font-semibold text-ink-400 uppercase tracking-wide">
        {t("users.colRole")}
      </th>
      <th className="px-4 py-3 text-start text-[11.5px] font-semibold text-ink-400 uppercase tracking-wide">
        {t("users.colStatus")}
      </th>
      <th className="px-4 py-3 text-start text-[11.5px] font-semibold text-ink-400 uppercase tracking-wide">
        {t("users.colColor")}
      </th>
      <th className="px-4 py-3 text-start text-[11.5px] font-semibold text-ink-400 uppercase tracking-wide">
        {t("users.colJoined")}
      </th>
      <th className="px-4 py-3 text-end text-[11.5px] font-semibold text-ink-400 uppercase tracking-wide">
        {t("users.colActions")}
      </th>
    </tr>
  );
}

// ─── Table row ────────────────────────────────────────────────────────────────
interface UserRowProps {
  user:         CompanyUserWithProfile;
  t:            TranslationFn;
  onEdit:       () => void;
  onToggle:     () => void;
}

function UserRow({ user, t, onEdit, onToggle }: UserRowProps) {
  const initials = user.user.full_name
    ?.split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() ?? "?";

  const joinedDate = new Date(user.created_at).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });

  return (
    <tr className="border-b border-ink-100 hover:bg-ink-50/50 transition-colors group">
      {/* Name + avatar */}
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-[12px] shrink-0"
            style={{ backgroundColor: user.color ?? "#6366F1" }}
          >
            {initials}
          </div>
          <div>
            <p className="font-semibold text-ink-800 text-[13px] leading-tight">
              {user.user.full_name}
            </p>
            {user.emp_id && (
              <p className="text-[11px] text-ink-400 leading-tight font-mono">
                {user.emp_id}
              </p>
            )}
          </div>
        </div>
      </td>

      {/* Email */}
      <td className="px-4 py-3.5">
        <span className="text-[13px] text-ink-600" dir="ltr">
          {user.user.email}
        </span>
      </td>

      {/* Role */}
      <td className="px-4 py-3.5">
        <RoleBadge role={user.role} t={t} />
      </td>

      {/* Status */}
      <td className="px-4 py-3.5">
        <StatusBadge status={user.status} t={t} />
      </td>

      {/* Color swatch */}
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-2">
          <span
            className="w-5 h-5 rounded-md border border-ink-200"
            style={{ backgroundColor: user.color ?? "#6366F1" }}
          />
          <span className="text-[11.5px] text-ink-400 font-mono">
            {user.color ?? "#6366F1"}
          </span>
        </div>
      </td>

      {/* Joined date */}
      <td className="px-4 py-3.5">
        <span className="text-[13px] text-ink-500">{joinedDate}</span>
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
            onClick={onToggle}
            title={user.status === "active" ? t("users.deactivate") : t("users.activate")}
            className={cn(
              "w-8 h-8 rounded-lg flex items-center justify-center transition-all",
              user.status === "active"
                ? "text-ink-400 hover:text-rose-500 hover:bg-rose-50"
                : "text-ink-400 hover:text-emerald-500 hover:bg-emerald-50"
            )}
          >
            {user.status === "active"
              ? <UserX    className="w-3.5 h-3.5" />
              : <UserCheck className="w-3.5 h-3.5" />}
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function UsersPage() {
  const { t } = useTranslation();
  const { data: users = [], isLoading, isError, error } = useUsers();

  // ── Modal state ─────────────────────────────────────────────────────────────
  const [showCreate,    setShowCreate]    = useState(false);
  const [editTarget,    setEditTarget]    = useState<CompanyUserWithProfile | null>(null);
  const [statusTarget,  setStatusTarget]  = useState<CompanyUserWithProfile | null>(null);

  // ── Filters ─────────────────────────────────────────────────────────────────
  const [search,     setSearch]     = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRole | "all">("all");

  const ROLES: Array<{ value: UserRole | "all"; label: string }> = [
    { value: "all",          label: t("users.allRoles") },
    { value: "owner",        label: t("role.owner") },
    { value: "admin",        label: t("role.admin") },
    { value: "merchandiser", label: t("role.merchandiser") },
  ];

  // ── Filtered data ───────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      const matchesRole   = roleFilter === "all" || u.role === roleFilter;
      const matchesSearch = !q ||
        u.user.full_name?.toLowerCase().includes(q) ||
        u.user.email?.toLowerCase().includes(q) ||
        u.emp_id?.toLowerCase().includes(q);
      return matchesRole && matchesSearch;
    });
  }, [users, search, roleFilter]);

  // ── Summary stats ───────────────────────────────────────────────────────────
  const totalCount  = users.length;
  const activeCount = users.filter((u) => u.status === "active").length;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-[24px] font-bold text-ink-900 flex items-center gap-2.5">
            <Users className="w-6 h-6 text-brand-500" />
            {t("users.pageTitle")}
          </h1>
          <p className="text-[13px] text-ink-400 mt-0.5">
            {t("users.pageSubtitle")}
          </p>
        </div>

        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-[13.5px] font-semibold shadow-pop transition-all shrink-0"
        >
          <Plus className="w-4 h-4" />
          {t("users.add")}
        </button>
      </div>

      {/* ── Stats pills ──────────────────────────────────────────────────── */}
      {!isLoading && !isError && totalCount > 0 && (
        <div className="flex flex-wrap gap-2 mb-5">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-ink-100 text-ink-600 text-[12px] font-semibold">
            <Users className="w-3.5 h-3.5" />
            {t("users.total").replace("{count}", String(totalCount))}
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[12px] font-semibold">
            <ToggleRight className="w-3.5 h-3.5" />
            {t("users.activeCount").replace("{count}", String(activeCount))}
          </span>
        </div>
      )}

      {/* ── Card ─────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-ink-100 shadow-soft overflow-hidden">

        {/* Toolbar */}
        {!isLoading && !isError && totalCount > 0 && (
          <div className="px-4 py-3.5 border-b border-ink-100 flex flex-wrap items-center gap-3">
            {/* Search */}
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("users.searchPlaceholder")}
                className="w-full h-9 ps-9 pe-3 rounded-lg border border-ink-200 bg-ink-50 text-[13px] text-ink-800 placeholder:text-ink-300 outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-100 transition-all"
              />
            </div>

            {/* Role filter */}
            <div className="relative">
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value as UserRole | "all")}
                className="h-9 ps-3 pe-8 rounded-lg border border-ink-200 bg-ink-50 text-[13px] text-ink-700 outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-100 transition-all appearance-none"
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
              <ChevronDown className="absolute end-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none" />
            </div>
          </div>
        )}

        {/* ── Loading ──────────────────────────────────────────────────── */}
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

        {/* ── Error ────────────────────────────────────────────────────── */}
        {isError && (
          <ErrorState message={(error as Error)?.message ?? t("common.noData")} />
        )}

        {/* ── Empty ────────────────────────────────────────────────────── */}
        {!isLoading && !isError && totalCount === 0 && (
          <EmptyState onAdd={() => setShowCreate(true)} t={t} />
        )}

        {/* ── Table ────────────────────────────────────────────────────── */}
        {!isLoading && !isError && totalCount > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><TableHead t={t} /></thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-ink-400 text-[13px]">
                      {t("common.noData")}
                    </td>
                  </tr>
                ) : (
                  filtered.map((user) => (
                    <UserRow
                      key={user.id}
                      user={user}
                      t={t}
                      onEdit={() => setEditTarget(user)}
                      onToggle={() => setStatusTarget(user)}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Modals ───────────────────────────────────────────────────────── */}
      {showCreate && (
        <UserModal onClose={() => setShowCreate(false)} />
      )}
      {editTarget && (
        <UserModal user={editTarget} onClose={() => setEditTarget(null)} />
      )}
      {statusTarget && (
        <StatusModal user={statusTarget} onClose={() => setStatusTarget(null)} />
      )}
    </>
  );
}
