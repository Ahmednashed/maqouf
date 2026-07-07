"use client";

import { memo, useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, X, MapPinned, CalendarDays, UserPlus, Store, FileDown,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { TranslationFn } from "@/hooks/use-translation";

// ─── Actions map ──────────────────────────────────────────────────────────────

interface QuickAction {
  key:   string;
  label: string;
  icon:  LucideIcon;
  href:  string;
  color: string;
}

// ─── Floating action button cluster ──────────────────────────────────────────

export const QuickActions = memo(function QuickActions({ t }: { t: TranslationFn }) {
  const router          = useRouter();
  const [open, setOpen] = useState(false);
  const ref             = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const ACTIONS: QuickAction[] = [
    { key: "visit",    label: t("dashboard.qa.createVisit"),    icon: MapPinned,    href: "/visits",   color: "bg-blue-500" },
    { key: "schedule", label: t("dashboard.qa.createSchedule"), icon: CalendarDays, href: "/schedule", color: "bg-violet-500" },
    { key: "invite",   label: t("dashboard.qa.inviteUser"),     icon: UserPlus,     href: "/users",    color: "bg-emerald-500" },
    { key: "branch",   label: t("dashboard.qa.newBranch"),      icon: Store,        href: "/places",   color: "bg-amber-500" },
    { key: "export",   label: t("dashboard.qa.exportReport"),   icon: FileDown,     href: "/reports",  color: "bg-ink-700" },
  ];

  return (
    <div ref={ref} className="fixed bottom-6 end-6 z-40 flex flex-col items-end gap-2">
      {/* Expanded actions — staggered entrance */}
      {open && (
        <div className="flex flex-col items-end gap-2.5" role="menu" aria-label="quick actions">
          {ACTIONS.map(({ key, label, icon: Icon, href, color }, i) => (
            <button
              key={key}
              role="menuitem"
              onClick={() => { setOpen(false); router.push(href); }}
              className={cn(
                "group flex items-center gap-2.5 animate-slide-up",
                "focus-visible:outline-none"
              )}
              style={{ animationDelay: `${(ACTIONS.length - 1 - i) * 40}ms`, animationFillMode: "backwards" }}
            >
              <span className={cn(
                "px-3 py-1.5 rounded-lg bg-ink-900/90 backdrop-blur text-white text-[11.5px] font-semibold shadow-pop",
                "transition-all opacity-90 group-hover:opacity-100 group-focus-visible:ring-2 group-focus-visible:ring-white"
              )}>
                {label}
              </span>
              <span
                className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center text-white shadow-pop",
                  "transition-all group-hover:scale-110 group-hover:shadow-modal",
                  "group-focus-visible:ring-2 group-focus-visible:ring-offset-2 group-focus-visible:ring-brand-400",
                  color
                )}
              >
                <Icon className="w-[18px] h-[18px]" />
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Main FAB */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="quick actions"
        aria-expanded={open}
        className={cn(
          "w-[52px] h-[52px] rounded-full flex items-center justify-center text-white shadow-modal",
          "transition-all duration-200 hover:scale-105 active:scale-95",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-400",
          open ? "bg-ink-700 rotate-90" : "bg-brand-500 hover:bg-brand-600"
        )}
      >
        {open ? <X className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
      </button>
    </div>
  );
});
