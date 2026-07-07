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
  Mail,
  Activity,
  Smartphone,
  UserMinus,
  UserPlus2,
  History,
} from "lucide-react";
import { cn }                  from "@/lib/utils/cn";
import { useTranslation, type TranslationFn } from "@/hooks/use-translation";
import { useUsers }            from "@/hooks/use-users";
import {
  memberDisplayName,
  memberEmail,
  memberInitials,
  memberAvatarUrl,
  type CompanyUserWithProfile,
} from "@/services/company-users";
import { formatRelativeTime }  from "@/lib/utils/format";
import type { UserRole }       from "@/types";
import { UserModal }           from "./_components/UserModal";
import { StatusModal }         from "./_components/StatusModal";
import { InvitationLinkModal } from "./_components/InvitationLinkModal";
import { UserActivityModal }   from "./_components/UserActivityModal";

// ─── Today boundary ───────────────────────────────────────────────────────────
function isToday(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() &&
         d.getMonth()    === n.getMonth()    &&
         d.getDate()     === n.getDate();
}

// ─── Summary cards ────────────────────────────────────────────────────────────
interface SummaryCardsProps {
  users: CompanyUserWithProfile[];
  t:     TranslationFn;
}

function SummaryCards({ users, t }: SummaryCardsProps) {
  const total    = users.length;
  const active   = users.filter((u) => u.status === "active").length;
  const inactive = users.filter((u) => u.status === "inactive").length;
  const online   = users.filter((u) => isToday(u.last_activity_at)).length;

  const cards = [
    { label: t("users.cardTotal"),     value: total,    icon: Users,     color: "bg-brand-50 text-brand-600" },
    { label: t("users.cardActive"),    value: active,   icon: UserPlus2, color: "bg-emerald-50 text-emerald-600" },
    { label: t("users.cardInactive"),  value: inactive, icon: UserMinus, color: "bg-ink-100 text-ink-500" },
    { label: t("users.cardOnlineToday"), value: online, icon: Activity,  color: "bg-blue-50 text-blue-600" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      {cards.map(({ label, value, icon: Icon, color }) => (
        <div key={label} className="bg-white rounded-2xl border border-ink-100 shadow-soft px-4 py-3.5 flex items-center gap-3">
          <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center shrink-0", color)}>
            <Icon className="w-4 h-4" />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-ink-400 uppercase tracking-wide leading-tight">{label}</p>
            <p className="text-[22px] font-bold text-ink-900 leading-tight">{value}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Skeleton row (9 cells) ───────────────────────────────────────────────────
function SkeletonRow() {
  return (
    <tr className="border-b border-ink-100">
      {[...Array(9)].map((_, i) => (
        <td key={i} className="px-4 py-3.5">
          <div className="h-4 rounded-md bg-ink-100 animate-pulse" style={{ width: `${55 + (i * 11) % 40}%` }} />
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
      <h3 className="text-[15px] font-semibold text-ink-700 mb-1">{t("users.emptyTitle")}</h3>
      <p className="text-[13px] text-ink-400 mb-6 max-w-xs">{t("users.emptyDesc")}</p>
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
    <span className={cn(
      "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11.5px] font-semibold",
      active ? "bg-emerald-50 text-emerald-700" : "bg-ink-100 text-ink-500"
    )}>
      {active ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
      {active ? t("common.active") : t("common.inactive")}
    </span>
  );
}

// ─── Role badge ───────────────────────────────────────────────────────────────
const ROLE_COLORS: Record<UserRole, string> = {
  owner:        "bg-amber-50 text-amber-700",
  admin:        "bg-blue-50 text-blue-700",
  merchandiser: "bg-violet-50 text-violet-700",
};

function RoleBadge({ role, t }: { role: UserRole; t: TranslationFn }) {
  return (
    <span className={cn("inline-flex px-2.5 py-1 rounded-full text-[11.5px] font-semibold", ROLE_COLORS[role])}>
      {t(`role.${role}`)}
    </span>
  );
}

// ─── Table head (9 columns) ───────────────────────────────────────────────────
function TableHead({ t }: { t: TranslationFn }) {
  const th = "px-4 py-3 text-start text-[11.5px] font-semibold text-ink-400 uppercase tracking-wide";
  return (
    <tr className="border-b border-ink-100 bg-ink-50/60">
      <th className={th}>{t("users.colName")}</th>
      <th className={th}>{t("users.colEmail")}</th>
      <th className={th}>{t("users.colRole")}</th>
      <th className={th}>{t("users.colStatus")}</th>
      <th className={th}>{t("users.colColor")}</th>
      <th className={th}>{t("users.colJoined")}</th>
      <th className={th}>{t("users.colLastActivity")}</th>
      <th className={th}>{t("users.colLastSync")}</th>
      <th className="px-4 py-3 text-end text-[11.5px] font-semibold text-ink-400 uppercase tracking-wide">
        {t("users.colActions")}
      </th>
    </tr>
  );
}

// ─── Table row ────────────────────────────────────────────────────────────────
interface UserRowProps {
  member:     CompanyUserWithProfile;
  t:          TranslationFn;
  locale:     string;
  onEdit:     () => void;
  onToggle:   () => void;
  onInvite:   () => void;
  onActivity: () => void;
}

function UserRow({ member, t, locale, onEdit, onToggle, onInvite, onActivity }: UserRowProps) {
  const displayName = memberDisplayName(member, t("users.unknown"));
  const email       = memberEmail(member);
  const initials    = memberInitials(member);
  const avatarUrl   = memberAvatarUrl(member);
  const isActive    = member.status === "active";
  const isOrphan    = !member.user;
  // Can invite anyone who has a reachable email — live or cached
  const canInvite   = !isActive && !!(member.user?.email || member.display_email);

  const joinedDate = new Date(member.created_at).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });

  const lastActivity = member.last_activity_at
    ? formatRelativeTime(member.last_activity_at, locale as "ar" | "en")
    : t("users.noActivity");

  const lastSync = member.last_mobile_sync
    ? formatRelativeTime(member.last_mobile_sync, locale as "ar" | "en")
    : t("users.neverSynced");

  return (
    <tr className={cn(
      "border-b border-ink-100 hover:bg-ink-50/50 transition-colors group",
      !isActive && "opacity-80"
    )}>
      {/* Name + avatar */}
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-3">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt=""
              className={cn("w-9 h-9 rounded-xl object-cover shrink-0", !isActive && "grayscale-[30%]")}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div
              className={cn(
                "w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-[12px] shrink-0",
                !isActive && "grayscale-[30%]"
              )}
              style={{ backgroundColor: member.color ?? "#6366F1" }}
            >
              {initials}
            </div>
          )}
          <div>
            <p className="font-semibold text-ink-800 text-[13px] leading-tight flex flex-wrap items-center gap-1">
              {displayName}
              {!isActive && !isOrphan && (
                <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full border border-amber-200">
                  {t("common.inactive")}
                </span>
              )}
              {isOrphan && (
                <span className="text-[10.5px] font-normal text-rose-400 bg-rose-50 px-1.5 py-0.5 rounded-full border border-rose-200">
                  {t("users.orphaned")}
                </span>
              )}
            </p>
            {member.emp_id && (
              <p className="text-[11px] text-ink-400 leading-tight font-mono">{member.emp_id}</p>
            )}
          </div>
        </div>
      </td>

      {/* Email */}
      <td className="px-4 py-3.5">
        <span className="text-[13px] text-ink-600" dir="ltr">{email}</span>
      </td>

      {/* Role */}
      <td className="px-4 py-3.5"><RoleBadge role={member.role} t={t} /></td>

      {/* Status */}
      <td className="px-4 py-3.5"><StatusBadge status={member.status} t={t} /></td>

      {/* Color */}
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-md border border-ink-200" style={{ backgroundColor: member.color ?? "#6366F1" }} />
          <span className="text-[11.5px] text-ink-400 font-mono">{member.color ?? "#6366F1"}</span>
        </div>
      </td>

      {/* Joined */}
      <td className="px-4 py-3.5">
        <span className="text-[13px] text-ink-500">{joinedDate}</span>
      </td>

      {/* Last Activity */}
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 text-ink-300 shrink-0" />
          <span className={cn("text-[12.5px]", member.last_activity_at ? "text-ink-600" : "text-ink-300")}>
            {lastActivity}
          </span>
        </div>
      </td>

      {/* Last Mobile Sync */}
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-1.5">
          <Smartphone className="w-3.5 h-3.5 text-ink-300 shrink-0" />
          <span className={cn("text-[12.5px]", member.last_mobile_sync ? "text-ink-600" : "text-ink-300")}>
            {lastSync}
          </span>
        </div>
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

          {/* View activity timeline */}
          <button
            onClick={onActivity}
            title={t("users.viewActivity")}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-400 hover:text-brand-500 hover:bg-brand-50 transition-all"
          >
            <History className="w-3.5 h-3.5" />
          </button>

          {canInvite && (
            <button
              onClick={onInvite}
              title={t("users.sendActivationEmail")}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-400 hover:text-brand-500 hover:bg-brand-50 transition-all"
            >
              <Mail className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            onClick={onToggle}
            title={isActive ? t("users.deactivate") : t("users.activate")}
            className={cn(
              "w-8 h-8 rounded-lg flex items-center justify-center transition-all",
              isActive
                ? "text-ink-400 hover:text-rose-500 hover:bg-rose-50"
                : "text-ink-400 hover:text-emerald-500 hover:bg-emerald-50"
            )}
          >
            {isActive ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function UsersPage() {
  const { t, locale } = useTranslation();
  const { data: users = [], isLoading, isError, error } = useUsers();

  const [showCreate,       setShowCreate]       = useState(false);
  const [editTarget,       setEditTarget]       = useState<CompanyUserWithProfile | null>(null);
  const [statusTarget,     setStatusTarget]     = useState<CompanyUserWithProfile | null>(null);
  const [invitationTarget, setInvitationTarget] = useState<CompanyUserWithProfile | null>(null);
  const [activityTarget,   setActivityTarget]   = useState<CompanyUserWithProfile | null>(null);

  const [search,       setSearch]       = useState("");
  const [roleFilter,   setRoleFilter]   = useState<UserRole | "all">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("active");

  const ROLES: Array<{ value: UserRole | "all"; label: string }> = [
    { value: "all",          label: t("users.allRoles") },
    { value: "owner",        label: t("role.owner") },
    { value: "admin",        label: t("role.admin") },
    { value: "merchandiser", label: t("role.merchandiser") },
  ];

  const STATUS_OPTS: Array<{ value: "all" | "active" | "inactive"; label: string }> = [
    { value: "all",      label: t("users.filterStatusAll") },
    { value: "active",   label: t("users.filterStatusActive") },
    { value: "inactive", label: t("users.filterStatusInactive") },
  ];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      const matchesRole   = roleFilter === "all" || u.role === roleFilter;
      const matchesStatus = statusFilter === "all" || u.status === statusFilter;
      const matchesSearch = !q ||
        memberDisplayName(u).toLowerCase().includes(q) ||
        memberEmail(u).toLowerCase().includes(q) ||
        u.emp_id?.toLowerCase().includes(q);
      return matchesRole && matchesStatus && matchesSearch;
    });
  }, [users, search, roleFilter, statusFilter]);

  return (
    <>
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-[24px] font-bold text-ink-900 flex items-center gap-2.5">
            <Users className="w-6 h-6 text-brand-500" />
            {t("users.pageTitle")}
          </h1>
          <p className="text-[13px] text-ink-400 mt-0.5">{t("users.pageSubtitle")}</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-[13.5px] font-semibold shadow-pop transition-all shrink-0"
        >
          <Plus className="w-4 h-4" />
          {t("users.add")}
        </button>
      </div>

      {/* Summary cards */}
      {!isLoading && !isError && users.length > 0 && (
        <SummaryCards users={users} t={t} />
      )}

      {/* Card */}
      <div className="bg-white rounded-2xl border border-ink-100 shadow-soft overflow-hidden">

        {/* Toolbar */}
        {!isLoading && !isError && users.length > 0 && (
          <div className="px-4 py-3.5 border-b border-ink-100 flex flex-wrap items-center gap-3">
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

            <div className="relative">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as "all" | "active" | "inactive")}
                className="h-9 ps-3 pe-8 rounded-lg border border-ink-200 bg-ink-50 text-[13px] text-ink-700 outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-100 transition-all appearance-none"
              >
                {STATUS_OPTS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
              <ChevronDown className="absolute end-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none" />
            </div>

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

        {/* Loading */}
        {isLoading && (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><TableHead t={t} /></thead>
              <tbody>{[...Array(5)].map((_, i) => <SkeletonRow key={i} />)}</tbody>
            </table>
          </div>
        )}

        {/* Error */}
        {isError && <ErrorState message={(error as Error)?.message ?? t("common.noData")} />}

        {/* Empty */}
        {!isLoading && !isError && users.length === 0 && (
          <EmptyState onAdd={() => setShowCreate(true)} t={t} />
        )}

        {/* Table */}
        {!isLoading && !isError && users.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><TableHead t={t} /></thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-ink-400 text-[13px]">
                      {t("common.noData")}
                    </td>
                  </tr>
                ) : (
                  filtered.map((member) => (
                    <UserRow
                      key={member.id}
                      member={member}
                      t={t}
                      locale={locale}
                      onEdit={()     => setEditTarget(member)}
                      onToggle={()   => setStatusTarget(member)}
                      onInvite={()   => setInvitationTarget(member)}
                      onActivity={() => setActivityTarget(member)}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      {showCreate && <UserModal onClose={() => setShowCreate(false)} />}
      {editTarget  && <UserModal user={editTarget} onClose={() => setEditTarget(null)} />}
      {statusTarget && <StatusModal user={statusTarget} onClose={() => setStatusTarget(null)} />}
      {invitationTarget && (
        <InvitationLinkModal
          user={invitationTarget}
          onClose={() => setInvitationTarget(null)}
        />
      )}
      {activityTarget && (
        <UserActivityModal
          user={activityTarget}
          onClose={() => setActivityTarget(null)}
        />
      )}
    </>
  );
}
