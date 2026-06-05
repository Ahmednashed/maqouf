"use client";

import { useEffect } from "react";
import { useAppStore } from "@/store/app-store";
import { getDir } from "@/lib/utils/locale";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { Providers } from "./providers";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { locale } = useAppStore();

  // Keep <html> lang + dir in sync with the Zustand locale.
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir  = getDir(locale);
  }, [locale]);

  return (
    <Providers>
      {/*
        Shell: horizontal flex row.
        – Sidebar occupies its own column via `hidden lg:flex` on the <aside>
          inside Sidebar.tsx.  On mobile the sidebar is a fixed overlay and
          takes NO space in this row.
        – The content column (`flex-1`) always fills the remaining width.
        – `overflow-hidden` on the shell prevents a stray horizontal scrollbar
          from appearing when the mobile drawer is animating.
      */}
      <div className="flex flex-row min-h-screen bg-ink-50 overflow-hidden">
        <Sidebar />

        {/* Content column: topbar + page body */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <Topbar />
          <main className="flex-1 overflow-y-auto overflow-x-hidden">
            <div className="px-4 md:px-8 py-6 md:py-8 max-w-[1400px] mx-auto page-enter">
              {children}
            </div>
          </main>
        </div>
      </div>
    </Providers>
  );
}
