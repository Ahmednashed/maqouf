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
      {/* Expanded actions */}
      {open && (
        <div className="flex flex-col items-end gap-2 animate-slide-up">
          {ACTIONS.map(({ key, label, icon: Icon, href, color }) => (
            <button
              key={key}
              onClick={() => { setOpen(false); router.push(href); }}
              className="group flex items-center gap-2.5"
            >
              <span className="px-2.5 py-1 rounded-lg bg-ink-900 text-white text-[11.5px] font-semibold shadow-pop opacity-90">
                {label}
              </span>
              <span
                className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center text-white shadow-pop",
                  "transition-transform group-hover:scale-110",
                  color
                )}
              >
                <Icon className="w-4.5 h-4.5 w-[18px] h-[18px]" />
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Main FAB */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="quick actions"
        className={cn(
          "w-13 h-13 w-[52px] h-[52px] rounded-full flex items-center justify-center text-white shadow-modal",
          "transition-all hover:scale-105",
          open ? "bg-ink-700 rotate-90" : "bg-brand-500 hover:bg-brand-600"
        )}
      >
        {open ? <X className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
      </button>
    </div>
  );
});
