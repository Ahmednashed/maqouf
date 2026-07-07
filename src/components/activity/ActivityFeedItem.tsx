"use client";

import {
  MapPinned,
  PlayCircle,
  CheckCircle2,
  XCircle,
  UserCheck,
  UserX,
  ShieldCheck,
  Mail,
  Pencil,
  Activity as ActivityIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { formatRelativeTime } from "@/lib/utils/format";
import type { TranslationFn } from "@/hooks/use-translation";
import type { TranslationKey } from "@/lib/i18n/translations";
import type { ActivityLog, Locale } from "@/types";

// ─── Action presentation map ──────────────────────────────────────────────────

interface ActionStyle {
  icon:  LucideIcon;
  color: string;   // icon bubble classes
}

const ACTION_STYLES: Record<string, ActionStyle> = {
  "visit.created":     { icon: MapPinned,    color: "bg-blue-50 text-blue-500" },
  "visit.started":     { icon: PlayCircle,   color: "bg-amber-50 text-amber-500" },
  "visit.completed":   { icon: CheckCircle2, color: "bg-emerald-50 text-emerald-500" },
  "visit.missed":      { icon: XCircle,      color: "bg-rose-50 text-rose-500" },
  "user.activated":    { icon: UserCheck,    color: "bg-emerald-50 text-emerald-500" },
  "user.deactivated":  { icon: UserX,        color: "bg-ink-100 text-ink-500" },
  "user.role_changed": { icon: ShieldCheck,  color: "bg-violet-50 text-violet-500" },
  "user.invited":      { icon: Mail,         color: "bg-brand-50 text-brand-500" },
  "user.updated":      { icon: Pencil,       color: "bg-blue-50 text-blue-500" },
};

const FALLBACK_STYLE: ActionStyle = {
  icon:  ActivityIcon,
  color: "bg-ink-100 text-ink-500",
};

/** Translated label for an action; unknown actions show the raw action key. */
export function actionLabel(action: string, t: TranslationFn): string {
  const key = `activity.action.${action}` as TranslationKey;
  const label = t(key);
  return label === key ? action : label;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface ActivityFeedItemProps {
  log:       ActivityLog;
  locale:    string;
  t:         TranslationFn;
  showActor?: boolean;   // hide when the timeline is already actor-scoped
  divider?:   boolean;
}

export function ActivityFeedItem({
  log,
  locale,
  t,
  showActor = true,
  divider = false,
}: ActivityFeedItemProps) {
  const { icon: Icon, color } = ACTION_STYLES[log.action] ?? FALLBACK_STYLE;
  const actor = log.actor_name?.trim() || t("activity.system");

  return (
    <div className={cn("flex items-center gap-3 px-4 py-3", divider && "border-t border-ink-50")}>
      {/* Action icon bubble */}
      <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center shrink-0", color)}>
        <Icon className="w-4 h-4" />
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-ink-800 truncate">
          {actionLabel(log.action, t)}
          {log.entity_label && (
            <span className="font-normal text-ink-500"> · {log.entity_label}</span>
          )}
        </p>
        {showActor && (
          <p className="text-[11px] text-ink-400 truncate">
            {t("activity.by", { name: actor })}
          </p>
        )}
      </div>

      {/* Time */}
      <p className="text-[10.5px] text-ink-400 shrink-0">
        {formatRelativeTime(log.created_at, locale as Locale)}
      </p>
    </div>
  );
}
