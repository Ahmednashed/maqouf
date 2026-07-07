"use client";

import { memo, useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Search, LayoutDashboard, Users, MapPinned, Store, Package,
  CalendarDays, ClipboardList, BarChart3, UserPlus, CornerDownLeft,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/hooks/use-translation";

// ─── Command registry (navigation + quick actions; UI-level only) ────────────

interface Command {
  key:     string;
  labelKey: string;
  icon:    LucideIcon;
  href:    string;
  group:   "navigate" | "actions";
  /** extra lowercase keywords matched during search */
  keywords: string;
}

const COMMANDS: Command[] = [
  { key: "dashboard", labelKey: "cmdk.dashboard", icon: LayoutDashboard, href: "/dashboard", group: "navigate", keywords: "home لوحة" },
  { key: "users",     labelKey: "cmdk.users",     icon: Users,           href: "/users",     group: "navigate", keywords: "team members مستخدم فريق" },
  { key: "visits",    labelKey: "cmdk.visits",    icon: MapPinned,       href: "/visits",    group: "navigate", keywords: "field زيارة" },
  { key: "places",    labelKey: "cmdk.places",    icon: Store,           href: "/places",    group: "navigate", keywords: "branch stores فرع" },
  { key: "products",  labelKey: "cmdk.products",  icon: Package,         href: "/products",  group: "navigate", keywords: "sku منتج" },
  { key: "schedules", labelKey: "cmdk.schedules", icon: CalendarDays,    href: "/schedule",  group: "navigate", keywords: "plan جدول" },
  { key: "templates", labelKey: "cmdk.templates", icon: ClipboardList,   href: "/templates", group: "navigate", keywords: "forms نموذج" },
  { key: "reports",   labelKey: "cmdk.reports",   icon: BarChart3,       href: "/reports",   group: "navigate", keywords: "analytics export تقرير" },
  { key: "qa-visit",  labelKey: "dashboard.qa.createVisit",  icon: MapPinned, href: "/visits",   group: "actions", keywords: "new create إنشاء" },
  { key: "qa-invite", labelKey: "dashboard.qa.inviteUser",   icon: UserPlus,  href: "/users",    group: "actions", keywords: "new invite دعوة" },
  { key: "qa-export", labelKey: "dashboard.qa.exportReport", icon: BarChart3, href: "/reports",  group: "actions", keywords: "download تصدير" },
];

// ─── Palette ──────────────────────────────────────────────────────────────────

interface CommandPaletteProps {
  open:    boolean;
  onClose: () => void;
}

export const CommandPalette = memo(function CommandPalette({
  open,
  onClose,
}: CommandPaletteProps) {
  const router   = useRouter();
  const { t }    = useTranslation();
  const [query, setQuery]       = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset + focus when opened
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      // next tick — the input mounts with the panel
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COMMANDS;
    return COMMANDS.filter((c) =>
      t(c.labelKey as Parameters<typeof t>[0]).toLowerCase().includes(q) ||
      c.keywords.includes(q) ||
      c.key.includes(q)
    );
  }, [query, t]);

  const run = useCallback((cmd: Command) => {
    onClose();
    router.push(cmd.href);
  }, [onClose, router]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); setSelected((s) => Math.min(s + 1, results.length - 1)); }
      else if (e.key === "ArrowUp")   { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); }
      else if (e.key === "Enter" && results[selected]) { e.preventDefault(); run(results[selected]); }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, results, selected, run, onClose]);

  // Clamp selection when the result set shrinks
  useEffect(() => {
    setSelected((s) => Math.min(s, Math.max(0, results.length - 1)));
  }, [results.length]);

  if (!open) return null;

  const groups: Array<{ key: Command["group"]; label: string }> = [
    { key: "navigate", label: t("cmdk.navigate") },
    { key: "actions",  label: t("cmdk.actions") },
  ];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center pt-[15vh] px-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("cmdk.hint")}
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm animate-fade-in" />

      {/* Panel */}
      <div
        className="relative w-full max-w-lg bg-white rounded-2xl shadow-modal border border-ink-100 overflow-hidden animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 border-b border-ink-100">
          <Search className="w-4 h-4 text-ink-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("cmdk.placeholder")}
            className="flex-1 h-12 text-[14px] text-ink-800 placeholder:text-ink-300 outline-none bg-transparent"
          />
          <kbd className="px-1.5 py-0.5 rounded border border-ink-200 bg-ink-50 text-[10px] font-semibold text-ink-400">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[320px] overflow-y-auto py-2">
          {results.length === 0 ? (
            <p className="text-[12.5px] text-ink-400 text-center py-8">{t("cmdk.noResults")}</p>
          ) : (
            groups.map(({ key: groupKey, label }) => {
              const items = results.filter((c) => c.group === groupKey);
              if (items.length === 0) return null;
              return (
                <div key={groupKey} className="px-2 pb-1">
                  <p className="px-2 pt-2 pb-1 text-[10px] font-bold text-ink-400 uppercase tracking-widest">
                    {label}
                  </p>
                  {items.map((cmd) => {
                    const idx      = results.indexOf(cmd);
                    const isActive = idx === selected;
                    const Icon     = cmd.icon;
                    return (
                      <button
                        key={cmd.key}
                        onClick={() => run(cmd)}
                        onMouseEnter={() => setSelected(idx)}
                        className={cn(
                          "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-start",
                          "transition-colors",
                          isActive ? "bg-brand-50 text-brand-700" : "text-ink-700 hover:bg-ink-50"
                        )}
                      >
                        <Icon className={cn("w-4 h-4 shrink-0", isActive ? "text-brand-500" : "text-ink-400")} />
                        <span className="flex-1 text-[13px] font-semibold truncate">
                          {t(cmd.labelKey as Parameters<typeof t>[0])}
                        </span>
                        {isActive && <CornerDownLeft className="w-3.5 h-3.5 text-brand-400" />}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
});

// ─── Global hotkey hook (Ctrl/Cmd + K) ────────────────────────────────────────

export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return { open, openPalette: () => setOpen(true), closePalette: () => setOpen(false) };
}
