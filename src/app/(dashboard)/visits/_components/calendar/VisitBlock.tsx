"use client";

import { memo } from "react";
import Link from "next/link";
import { ClipboardList, Repeat, Play, Check, AlertCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { TranslationFn } from "@/hooks/use-translation";
import type { CalendarVisitItem } from "@/lib/calendar-model";
import type { VisitStatus } from "@/types";

// ─────────────────────────────────────────────────────────────────────────────
// One visit as a calendar block.
//
// Status is carried by BOTH an icon and a colour, never colour alone, so the
// grid stays readable for colour-vision-deficient users and in print.
// Clicking opens the existing visit detail route — no business logic here.
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<VisitStatus, { chip: string; icon: typeof Check }> = {
  pending:    { chip: "border-ink-200 bg-white text-ink-700",              icon: Clock },
  inprogress: { chip: "border-blue-300 bg-blue-50 text-blue-800",          icon: Play },
  completed:  { chip: "border-emerald-200 bg-emerald-50 text-emerald-800", icon: Check },
  missed:     { chip: "border-rose-200 bg-rose-50 text-rose-700",          icon: AlertCircle },
};

interface VisitBlockProps {
  item:     CalendarVisitItem;
  t:        TranslationFn;
  /** `compact` is used inside dense week cells. */
  compact?: boolean;
  className?: string;
  style?:   React.CSSProperties;
}

export const VisitBlock = memo(function VisitBlock({
  item, t, compact = false, className, style,
}: VisitBlockProps) {
  const style_ = STATUS_STYLE[item.status];
  const Icon   = style_.icon;

  // One sentence that reads correctly to a screen reader: what, who, when, state.
  const label = [
    item.placeName,
    item.merchName,
    item.time ? `${t("visits.calendar.at")} ${item.time}` : t("visits.calendar.noTime"),
    t(`visits.status.${item.status}` as Parameters<typeof t>[0]),
    item.origin === "unplanned" ? t("visits.calendar.unplanned") : "",
    // Announce the checklist too, so the label matches what the icon conveys.
    item.hasTemplate ? (item.templateName ?? t("visits.calendar.hasTemplate")) : "",
  ].filter(Boolean).join(" · ");

  return (
    <Link
      href={`/visits/${item.id}`}
      aria-label={label}
      title={label}
      style={style}
      className={cn(
        "group block rounded-lg border shadow-sm overflow-hidden transition-all",
        "hover:shadow-md hover:-translate-y-px",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-1",
        style_.chip,
        compact ? "px-1.5 py-1" : "px-2 py-1.5",
        className
      )}
    >
      <span className="flex items-center gap-1 min-w-0">
        <Icon className={cn("shrink-0", compact ? "w-2.5 h-2.5" : "w-3 h-3")} aria-hidden="true" />
        <span className={cn("font-semibold truncate", compact ? "text-[10.5px]" : "text-[11.5px]")}>
          {item.placeName}
        </span>
        {/* Subtle repeat mark — origin, not a loud badge on every block. */}
        {item.origin === "planned" && !compact && (
          <Repeat className="w-2.5 h-2.5 opacity-40 shrink-0" aria-hidden="true" />
        )}
        {/* Checklist mark: this visit has a template to fill in. Same weight as
            the repeat mark — an indicator while scanning, not a badge. */}
        {item.hasTemplate && (
          <ClipboardList
            className={cn("opacity-45 shrink-0", compact ? "w-2 h-2" : "w-2.5 h-2.5")}
            aria-hidden="true"
          />
        )}
      </span>

      {!compact && (
        <span className="flex items-center gap-1 mt-0.5 min-w-0">
          {item.time && (
            <span className="text-[10px] tabular-nums opacity-70 shrink-0" dir="ltr">
              {item.time}
            </span>
          )}
          {item.chainName && (
            <span className="text-[10px] opacity-60 truncate">{item.chainName}</span>
          )}
          {item.origin === "unplanned" && (
            <span className="text-[9px] font-bold px-1 rounded bg-amber-100 text-amber-800 shrink-0">
              {t("visits.calendar.unplanned")}
            </span>
          )}
        </span>
      )}
    </Link>
  );
});
