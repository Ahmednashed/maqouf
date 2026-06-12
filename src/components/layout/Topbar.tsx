"use client";

import { useRef, useState, useEffect } from "react";
import { Bell, Languages, Menu, LogOut, User, ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAppStore }       from "@/store/app-store";
import { useTranslation }    from "@/hooks/use-translation";
import { useCurrentMember, currentMemberLabel } from "@/hooks/use-current-member";
import { createClient }      from "@/lib/supabase/client";
import { cn }                from "@/lib/utils/cn";

// ─── Account menu dropdown ────────────────────────────────────────────────────

function AccountMenu() {
  const router          = useRouter();
  const { t }           = useTranslation();
  const { data: member, isLoading } = useCurrentMember();
  const [open, setOpen] = useState(false);
  const ref             = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  async function handleLogout() {
    setOpen(false);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  const label    = currentMemberLabel(member);
  const initials = label
    ? label.split(" ").filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase()
    : "?";

  if (isLoading) {
    return <div className="w-9 h-9 rounded-xl bg-ink-100 animate-pulse" />;
  }

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-2 h-10 ps-1 pe-2.5 rounded-xl border transition-all",
          "hover:bg-ink-50 hover:border-ink-300",
          open ? "bg-ink-50 border-ink-300" : "bg-white border-ink-200"
        )}
      >
        {/* Avatar / initials */}
        {member?.avatarUrl ? (
          <img
            src={member.avatarUrl}
            alt=""
            className="w-8 h-8 rounded-lg object-cover shrink-0"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[11px] font-bold shrink-0"
            style={{ backgroundColor: member?.color ?? "#6366F1" }}
          >
            {initials}
          </div>
        )}

        {/* Name (hidden on small screens) */}
        <span className="hidden sm:block text-[13px] font-semibold text-ink-700 max-w-[120px] truncate leading-tight">
          {label || member?.email || ""}
        </span>

        <ChevronDown className={cn("w-3.5 h-3.5 text-ink-400 transition-transform", open && "rotate-180")} />
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute end-0 top-[calc(100%+6px)] w-64 bg-white rounded-2xl border border-ink-100 shadow-modal z-50 overflow-hidden animate-slide-up">
          {/* Identity header */}
          <div className="px-4 py-3.5 border-b border-ink-100 flex items-center gap-3">
            {member?.avatarUrl ? (
              <img
                src={member.avatarUrl}
                alt=""
                className="w-10 h-10 rounded-xl object-cover shrink-0"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
            ) : (
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-[13px] font-bold shrink-0"
                style={{ backgroundColor: member?.color ?? "#6366F1" }}
              >
                {initials}
              </div>
            )}
            <div className="min-w-0">
              {label && (
                <p className="text-[13.5px] font-bold text-ink-900 truncate leading-tight">{label}</p>
              )}
              <p className="text-[12px] text-ink-400 truncate leading-tight" dir="ltr">
                {member?.email ?? ""}
              </p>
              {member?.role && (
                <span className="inline-block mt-0.5 text-[10.5px] font-semibold text-brand-600 bg-brand-50 px-1.5 py-0.5 rounded-full">
                  {t(`role.${member.role}` as Parameters<typeof t>[0])}
                </span>
              )}
            </div>
          </div>

          {/* Menu items */}
          <div className="py-1.5">
            <button
              onClick={() => { setOpen(false); router.push("/users"); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-[13px] text-ink-700 hover:bg-ink-50 transition-colors"
            >
              <User className="w-4 h-4 text-ink-400 shrink-0" />
              {t("nav.users")}
            </button>

            <div className="mx-3 my-1 border-t border-ink-100" />

            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-[13px] text-rose-600 hover:bg-rose-50 transition-colors"
            >
              <LogOut className="w-4 h-4 shrink-0" />
              {t("auth.logout")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Topbar ───────────────────────────────────────────────────────────────────

export function Topbar() {
  const { t, locale }               = useTranslation();
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

      {/* Account menu */}
      <AccountMenu />
    </header>
  );
}
