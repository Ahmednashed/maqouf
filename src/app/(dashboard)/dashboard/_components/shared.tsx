"use client";

import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils/cn";

// ─── Section header ───────────────────────────────────────────────────────────

export function SectionHeader({
  title,
  icon: Icon,
  action,
}: {
  title:   string;
  icon?:   React.ElementType;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-1 h-5 rounded-full bg-brand-500" />
      {Icon && <Icon className="w-3.5 h-3.5 text-brand-400" />}
      <h2 className="text-[13px] font-bold text-ink-700">{title}</h2>
      {action && <div className="ms-auto">{action}</div>}
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-ink-100", className)} />;
}

// ─── Trend arrow (today vs yesterday) ────────────────────────────────────────

export function TrendArrow({
  today,
  yesterday,
  label,
  /** When true, an increase is bad (overdue, sync issues). */
  invert = false,
}: {
  today:     number;
  yesterday: number;
  label:     string;
  invert?:   boolean;
}) {
  const diff = today - yesterday;
  const good = invert ? diff < 0 : diff > 0;

  if (diff === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10.5px] font-semibold text-ink-400">
        <Minus className="w-3 h-3" />
        {label}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-[10.5px] font-semibold",
        good ? "text-emerald-600" : "text-rose-500"
      )}
    >
      {diff > 0
        ? <TrendingUp   className="w-3 h-3" />
        : <TrendingDown className="w-3 h-3" />}
      {diff > 0 ? "+" : ""}{diff} {label}
    </span>
  );
}
