"use client";

import { memo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  UsersRound,
  ShieldCheck,
  Battery,
  SignalHigh,
  MapPinned,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { TranslationFn } from "@/hooks/use-translation";
import { formatRelativeTime } from "@/lib/utils/format";
import {
  presenceOf,
  hasSyncIssue,
  type TeamMemberStatus,
  type PresenceState,
} from "@/services/dashboard-extras";
import type { Locale } from "@/types";
import { SectionHeader, Skeleton } from "./shared";

// ─── Presence pill ────────────────────────────────────────────────────────────

const PRESENCE_STYLES: Record<PresenceState, { dot: string; pill: string }> = {
  online:  { dot: "bg-emerald-500", pill: "bg-emerald-50 text-emerald-700" },
  idle:    { dot: "bg-amber-400",   pill: "bg-amber-50 text-amber-700" },
  offline: { dot: "bg-ink-300",     pill: "bg-ink-100 text-ink-500" },
};

function PresencePill({ state, t }: { state: PresenceState; t: TranslationFn }) {
  const { dot, pill } = PRESENCE_STYLES[state];
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold", pill)}>
      <span className={cn("w-1.5 h-1.5 rounded-full", dot, state === "online" && "animate-pulse")} />
      {t(`dashboard.team.${state}`)}
    </span>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────

const TeamRow = memo(function TeamRow({
  member,
  t,
  locale,
  onOpen,
}: {
  member: TeamMemberStatus;
  t:      TranslationFn;
  locale: string;
  onOpen: () => void;
}) {
  const presence = presenceOf(member.last_activity_at);
  const syncBad  = hasSyncIssue(member.last_mobile_sync);
  const initials = member.name
    .split(" ").filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";

  return (
    <tr
      onClick={onOpen}
      className="border-b border-ink-50 hover:bg-ink-50/60 transition-colors cursor-pointer"
    >
      {/* Avatar + name */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {member.avatar_url ? (
            <img
              src={member.avatar_url}
              alt=""
              className="w-8 h-8 rounded-lg object-cover shrink-0"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[11px] font-bold shrink-0"
              style={{ backgroundColor: member.color ?? "#6366F1" }}
            >
              {initials}
            </div>
          )}
          <span className="text-[13px] font-semibold text-ink-800 truncate">{member.name}</span>
        </div>
      </td>

      {/* Region */}
      <td className="px-4 py-3 text-[12.5px] text-ink-500">{member.region || "—"}</td>

      {/* Presence */}
      <td className="px-4 py-3"><PresencePill state={presence} t={t} /></td>

      {/* GPS (from current in-progress visit) */}
      <td className="px-4 py-3">
        {member.current_visit?.checkin_verified ? (
          <ShieldCheck className="w-4 h-4 text-emerald-500" />
        ) : (
          <span className="text-ink-300 text-[12px]">—</span>
        )}
      </td>

      {/* Current visit */}
      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
        {member.current_visit ? (
          <Link
            href={`/visits/${member.current_visit.id}`}
            className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-brand-600 hover:underline"
          >
            <MapPinned className="w-3 h-3" />
            {locale === "ar" ? member.current_visit.branch_ar : member.current_visit.branch_en}
          </Link>
        ) : (
          <span className="text-ink-300 text-[12px]">{t("dashboard.team.noVisit")}</span>
        )}
      </td>

      {/* Last activity */}
      <td className="px-4 py-3 text-[12px] text-ink-500 whitespace-nowrap">
        {member.last_activity_at
          ? formatRelativeTime(member.last_activity_at, locale as Locale)
          : "—"}
      </td>

      {/* Last sync */}
      <td className="px-4 py-3 whitespace-nowrap">
        <span className={cn("text-[12px]", syncBad ? "text-rose-500 font-semibold" : "text-ink-500")}>
          {member.last_mobile_sync
            ? formatRelativeTime(member.last_mobile_sync, locale as Locale)
            : t("users.neverSynced")}
        </span>
      </td>

      {/* Battery / Signal — placeholders (no data source yet) */}
      <td className="px-4 py-3"><Battery    className="w-4 h-4 text-ink-200" /></td>
      <td className="px-4 py-3"><SignalHigh className="w-4 h-4 text-ink-200" /></td>
    </tr>
  );
});

// ─── Table ────────────────────────────────────────────────────────────────────

interface FieldTeamTableProps {
  team?:    TeamMemberStatus[];
  loading:  boolean;
  t:        TranslationFn;
  locale:   string;
}

export const FieldTeamTable = memo(function FieldTeamTable({
  team = [],
  loading,
  t,
  locale,
}: FieldTeamTableProps) {
  const router = useRouter();

  const HEADERS = [
    "dashboard.team.colName",   "dashboard.team.colRegion",  "dashboard.team.colStatus",
    "dashboard.team.colGps",    "dashboard.team.colVisit",   "dashboard.team.colActivity",
    "dashboard.team.colSync",   "dashboard.team.colBattery", "dashboard.team.colSignal",
  ] as const;

  return (
    <div>
      <SectionHeader title={t("dashboard.section.team")} icon={UsersRound} />

      {loading ? (
        <Skeleton className="h-[220px]" />
      ) : team.length === 0 ? (
        <div className="bg-white rounded-2xl border border-ink-100 p-8 text-center shadow-sm">
          <UsersRound className="w-8 h-8 text-ink-300 mx-auto mb-2" />
          <p className="text-[13px] text-ink-400">{t("dashboard.team.empty")}</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-ink-100 shadow-sm overflow-x-auto">
          <table className="w-full text-[13px] min-w-[760px]">
            <thead>
              <tr className="border-b border-ink-100 bg-ink-50/60">
                {HEADERS.map((key) => (
                  <th
                    key={key}
                    className="px-4 py-2.5 text-start text-[10.5px] font-semibold text-ink-400 uppercase tracking-wide whitespace-nowrap"
                  >
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {team.map((m) => (
                <TeamRow
                  key={m.id}
                  member={m}
                  t={t}
                  locale={locale}
                  onOpen={() => router.push("/users")}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
});
