"use client";
import { Bell, Languages, Menu } from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { useTranslation } from "@/hooks/use-translation";
import { cn } from "@/lib/utils/cn";

export function Topbar() {
  const { t, locale }  = useTranslation();
  const { toggleLocale, setSidebarOpen } = useAppStore();

  return (
    <header className="sticky top-0 z-20 h-16 bg-white/80 backdrop-blur-xl border-b border-ink-200 flex items-center px-4 gap-3">
      {/* Mobile menu toggle */}
      <button
        onClick={() => setSidebarOpen(true)}
        className="lg:hidden h-10 w-10 rounded-xl border border-ink-200 flex items-center justify-center text-ink-600 hover:bg-ink-50"
      >
        <Menu className="w-5 h-5" />
      </button>

      <div className="flex-1" />

      {/* Lang toggle */}
      <button
        onClick={toggleLocale}
        className="inline-flex items-center gap-2 h-10 px-3.5 rounded-xl border border-ink-200 bg-white hover:bg-ink-50 hover:border-ink-300 text-[13px] font-semibold text-ink-700 transition-all"
      >
        <Languages className="w-4 h-4" />
        <span>{locale === "ar" ? "EN" : "AR"}</span>
      </button>

      {/* Notifications */}
      <button className="relative h-10 w-10 rounded-xl border border-ink-200 bg-white hover:bg-ink-50 flex items-center justify-center text-ink-600 transition-all">
        <Bell className="w-4 h-4" />
        <span className="absolute top-2 end-2 h-2 w-2 rounded-full bg-brand-500 ring-2 ring-white" />
      </button>
    </header>
  );
}
