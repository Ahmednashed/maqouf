"use client";

import { memo } from "react";
import {
  Database, MapPinned, UsersRound, Activity, RefreshCw, Clock,
  Store, HeartPulse, AlertTriangle, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/hooks/use-translation";
import type { AiOperationalContext } from "@/services/ai-operations";

// ─── One context source row ───────────────────────────────────────────────────

function CtxRow({
  icon: Icon,
  label,
  value,
  warn = false,
}: {
  icon:  LucideIcon;
  label: string;
  value: string | number;
  warn?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-ink-50/70 transition-colors">
      <div className={cn(
        "w-7 h-7 rounded-lg flex items-center justify-center shrink-0",
        warn ? "bg-rose-50 text-rose-500" : "bg-violet-50 text-violet-500"
      )}>
        <Icon className="w-3.5 h-3.5" />
      </div>
      <span className="flex-1 min-w-0 text-[12px] text-ink-600 font-medium truncate">{label}</span>
      <span className={cn(
        "text-[12.5px] font-bold shrink-0",
        warn ? "text-rose-500" : "text-ink-800"
      )}>
        {value}
      </span>
    </div>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

interface AiContextPanelProps {
  context?:  AiOperationalContext;
  loading:   boolean;
}

export const AiContextPanel = memo(function AiContextPanel({
  context,
  loading,
}: AiContextPanelProps) {
  const { t } = useTranslation();

  return (
    <div className="bg-white rounded-2xl border border-ink-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-ink-100 bg-gradient-to-r from-violet-50/70 to-transparent">
        <p className="flex items-center gap-2 text-[13px] font-bold text-ink-800">
          <Database className="w-4 h-4 text-violet-500" />
          {t("ai.contextTitle")}
        </p>
        <p className="text-[11px] text-ink-400 mt-0.5">{t("ai.contextDesc")}</p>
      </div>

      {/* Rows */}
      <div className="p-2">
        {loading || !context ? (
          <div className="space-y-2 p-1">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-9 rounded-xl bg-ink-100 animate-pulse" />
            ))}
          </div>
        ) : (
          <>
            <CtxRow icon={MapPinned}  label={t("ai.ctxVisits")}   value={context.dashboard?.todayTotal ?? "—"} />
            <CtxRow icon={UsersRound} label={t("ai.ctxTeam")}     value={context.extras?.team.length ?? "—"} />
            <CtxRow icon={Store}      label={t("ai.ctxBranches")} value={context.branches.length} />
            <CtxRow icon={Activity}   label={t("ai.ctxActivity")} value={context.activity.length} />
            <CtxRow icon={HeartPulse} label={t("ai.ctxHealth")}   value={`${context.insights.healthScore}/100`} />
            <CtxRow
              icon={RefreshCw}
              label={t("ai.ctxSync")}
              value={context.extras?.syncIssuesCount ?? "—"}
              warn={(context.extras?.syncIssuesCount ?? 0) > 0}
            />
            <CtxRow
              icon={Clock}
              label={t("ai.ctxOverdue")}
              value={context.extras?.overdueCount ?? "—"}
              warn={(context.extras?.overdueCount ?? 0) > 0}
            />
          </>
        )}
      </div>

      {/* Degraded warning + disclaimer */}
      <div className="px-4 py-3 border-t border-ink-50 space-y-1.5">
        {context?.degraded && (
          <p className="flex items-start gap-1.5 text-[10.5px] text-amber-600 font-medium">
            <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
            {t("ai.errorLoad")}
          </p>
        )}
        <p className="text-[10.5px] text-ink-300 leading-snug">{t("ai.disclaimer")}</p>
      </div>
    </div>
  );
});
