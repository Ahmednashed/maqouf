"use client";

import { memo } from "react";
import Link from "next/link";
import { BellRing, WifiOff, MapPinOff, Clock, RefreshCw, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { TranslationFn } from "@/hooks/use-translation";
import { SectionHeader, Skeleton, AnimatedNumber } from "./shared";

// ─── Alert card ───────────────────────────────────────────────────────────────

interface AlertDef {
  key:   string;
  label: string;
  value: number;
  icon:  LucideIcon;
  href:  string;
  /** Accent used only when value > 0; zero renders neutral. */
  accent: { bubble: string; ring: string };
}

const AlertCard = memo(function AlertCard({ def }: { def: AlertDef }) {
  const { label, value, icon: Icon, href, accent } = def;
  const active = value > 0;

  return (
    <Link
      href={href}
      aria-label={`${label}: ${value}`}
      className={cn(
        "bg-white rounded-2xl border p-3.5 shadow-sm flex items-center gap-3",
        "transition-all duration-200 hover:shadow-md hover:-translate-y-0.5",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
        active ? accent.ring : "border-ink-100"
      )}
    >
      <div className={cn(
        "w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
        active ? accent.bubble : "bg-ink-50 text-ink-300"
      )}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0">
        <p className={cn(
          "text-[19px] font-bold leading-none",
          active ? "text-ink-900" : "text-ink-300"
        )}>
          <AnimatedNumber value={value} />
        </p>
        <p className="text-[10.5px] text-ink-500 font-medium mt-1 truncate">{label}</p>
      </div>
    </Link>
  );
});

// ─── Component ────────────────────────────────────────────────────────────────

interface SmartAlertsProps {
  offline:  number;
  gps:      number;
  delayed:  number;
  sync:     number;
  loading:  boolean;
  t:        TranslationFn;
}

export const SmartAlerts = memo(function SmartAlerts({
  offline,
  gps,
  delayed,
  sync,
  loading,
  t,
}: SmartAlertsProps) {
  const alerts: AlertDef[] = [
    {
      key: "offline", label: t("dashboard.alert.offline"), value: offline,
      icon: WifiOff, href: "/users",
      accent: { bubble: "bg-ink-100 text-ink-600", ring: "border-ink-200" },
    },
    {
      key: "gps", label: t("dashboard.alert.gps"), value: gps,
      icon: MapPinOff, href: "/visits",
      accent: { bubble: "bg-rose-50 text-rose-500", ring: "border-rose-200" },
    },
    {
      key: "delayed", label: t("dashboard.alert.delayed"), value: delayed,
      icon: Clock, href: "/visits",
      accent: { bubble: "bg-amber-50 text-amber-600", ring: "border-amber-200" },
    },
    {
      key: "sync", label: t("dashboard.alert.sync"), value: sync,
      icon: RefreshCw, href: "/users",
      accent: { bubble: "bg-rose-50 text-rose-500", ring: "border-rose-200" },
    },
  ];

  return (
    <div>
      <SectionHeader title={t("dashboard.alert.title")} icon={BellRing} />

      {loading ? (
        <div className="grid grid-cols-2 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-[72px]" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {alerts.map((a) => <AlertCard key={a.key} def={a} />)}
        </div>
      )}
    </div>
  );
});
