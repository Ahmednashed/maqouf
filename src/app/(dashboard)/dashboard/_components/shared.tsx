"use client";

import { useEffect, useRef, useState } from "react";
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

// ─── Skeleton (shimmer) ───────────────────────────────────────────────────────

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl bg-ink-100",
        "after:absolute after:inset-0 after:-translate-x-full",
        "after:bg-gradient-to-r after:from-transparent after:via-white/60 after:to-transparent",
        "after:animate-[shimmer_1.6s_infinite]",
        className
      )}
    />
  );
}

// ─── Animated number ──────────────────────────────────────────────────────────
//
// Eases from 0 (or the previous value) to `value` in ~650 ms.
// Falls back to a static render when prefers-reduced-motion is set.

export function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(0);

  useEffect(() => {
    if (typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(value);
      prevRef.current = value;
      return;
    }

    const from     = prevRef.current;
    const duration = 650;
    const start    = performance.now();
    let  raf       = 0;

    function tick(now: number) {
      const p     = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);   // easeOutCubic
      setDisplay(Math.round(from + (value - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);
    prevRef.current = value;
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <>{display}</>;
}

// ─── Trend badge (percentage vs yesterday) ────────────────────────────────────

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

  if (diff === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10.5px] font-semibold text-ink-400">
        <Minus className="w-3 h-3" />
        {label}
      </span>
    );
  }

  const good = invert ? diff < 0 : diff > 0;
  // Percentage when yesterday has a base; absolute diff otherwise
  const pct  = yesterday > 0 ? Math.round((diff / yesterday) * 100) : null;
  const text = pct !== null
    ? `${pct > 0 ? "+" : ""}${pct}%`
    : `${diff > 0 ? "+" : ""}${diff}`;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10.5px] font-semibold",
        good ? "text-emerald-600" : "text-rose-500"
      )}
    >
      <span className={cn(
        "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full",
        good ? "bg-emerald-50" : "bg-rose-50"
      )}>
        {diff > 0
          ? <TrendingUp   className="w-3 h-3" />
          : <TrendingDown className="w-3 h-3" />}
        {text}
      </span>
      <span className="text-ink-400 font-medium">{label}</span>
    </span>
  );
}

// ─── Sparkline placeholder ────────────────────────────────────────────────────
//
// Static decorative mini-chart. Replaced with real per-KPI history later.

export function Sparkline({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 20"
      className={cn("w-16 h-5", className)}
      aria-hidden="true"
      fill="none"
    >
      <path
        d="M1 15 L9 12 L17 14 L25 8 L33 10 L41 5 L49 7 L57 3 L63 4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.5"
      />
      <path
        d="M1 15 L9 12 L17 14 L25 8 L33 10 L41 5 L49 7 L57 3 L63 4 L63 20 L1 20 Z"
        fill="currentColor"
        opacity="0.08"
      />
    </svg>
  );
}
