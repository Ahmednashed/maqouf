"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, MapPinned, CalendarDays, Building2,
  Store, Users, Package, Layers, ClipboardList, BarChart3,
  ChevronLeft, ChevronRight, LogOut, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useAppStore } from "@/store/app-store";
import { useTranslation } from "@/hooks/use-translation";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

// ─── Nav items ────────────────────────────────────────────────────────────────

interface NavItem {
  key:   string;
  href:  string;
  icon:  React.ElementType;
  badge?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { key: "nav.dashboard",  href: "/dashboard",      icon: LayoutDashboard },
  { key: "nav.ai",         href: "/ai",              icon: Sparkles },
  { key: "nav.visits",     href: "/visits",          icon: MapPinned,     badge: true },
  { key: "nav.schedule",   href: "/schedule",        icon: CalendarDays },
  { key: "nav.chains",     href: "/chains",          icon: Building2 },
  { key: "nav.places",     href: "/places",          icon: Store },
  { key: "nav.users",      href: "/users",           icon: Users },
  { key: "nav.products",   href: "/products",        icon: Package },
  { key: "nav.assortment", href: "/place-products", icon: Layers },
  { key: "nav.templates",  href: "/templates",       icon: ClipboardList },
  { key: "nav.reports",    href: "/reports",         icon: BarChart3,     badge: true },
];

// ─── Brand icon ───────────────────────────────────────────────────────────────

function BrandIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" rx="10" fill="#111827"/>
      <circle cx="20" cy="17" r="7.5" fill="none" stroke="#FFFFFF" strokeWidth="2.2"/>
      <circle cx="20" cy="17" r="3.2" fill="#EF4444"/>
      <path d="M14.5 23L20 30L25.5 23Z" fill="#E5E7EB"/>
    </svg>
  );
}

// ─── Shared panel content ─────────────────────────────────────────────────────
// Rendered identically inside the desktop aside and the mobile drawer.

interface PanelProps {
  expanded:    boolean;   // true = full labels visible, false = icon-only
  locale:      string;
  t:           ReturnType<typeof useTranslation>["t"];
  pathname:    string;
  onToggle:    () => void;
  onLogout:    () => void;
}

function SidebarPanel({ expanded, locale, t, pathname, onToggle, onLogout }: PanelProps) {
  return (
    <>
      {/* Brand row */}
      <div className="h-16 shrink-0 flex items-center justify-between px-4 border-b border-ink-200">
        {expanded && (
          <Link href="/dashboard" className="flex items-center gap-2.5 min-w-0">
            <BrandIcon />
            <span className="text-[18px] font-bold text-ink-900 tracking-tight truncate">
              {t("brand.name")}
            </span>
          </Link>
        )}
        <button
          onClick={onToggle}
          aria-label="toggle sidebar"
          className={cn(
            "h-8 w-8 rounded-lg flex items-center justify-center shrink-0",
            "text-ink-500 hover:bg-ink-100 transition-colors",
            !expanded && "mx-auto"
          )}
        >
          {expanded
            ? (locale === "ar"
                ? <ChevronRight className="w-4 h-4" />
                : <ChevronLeft  className="w-4 h-4" />)
            : (locale === "ar"
                ? <ChevronLeft  className="w-4 h-4" />
                : <ChevronRight className="w-4 h-4" />)
          }
        </button>
      </div>

      {/* Nav links */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {NAV_ITEMS.map(({ key, href, icon: Icon, badge }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "relative flex items-center gap-3 h-10 px-3 rounded-xl",
                "text-[13px] font-semibold transition-all",
                active
                  ? "bg-brand-50 text-brand-600"
                  : "text-ink-600 hover:bg-ink-50 hover:text-ink-900"
              )}
            >
              <Icon className={cn("w-[18px] h-[18px] shrink-0", active && "text-brand-500")} />
              {expanded && (
                <>
                  <span className="truncate">{t(key as Parameters<typeof t>[0])}</span>
                  {badge && (
                    <span className="ms-auto h-5 min-w-5 px-1 rounded-full bg-brand-500 text-white text-[10px] font-bold flex items-center justify-center">
                      !
                    </span>
                  )}
                </>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="shrink-0 p-2 border-t border-ink-200">
        <button
          onClick={onLogout}
          className={cn(
            "w-full flex items-center gap-3 h-10 px-3 rounded-xl",
            "text-[13px] font-semibold text-ink-600",
            "hover:bg-rose-50 hover:text-rose-600 transition-all"
          )}
        >
          <LogOut className="w-[18px] h-[18px] shrink-0" />
          {expanded && <span>{t("auth.logout")}</span>}
        </button>
      </div>
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function Sidebar() {
  const pathname               = usePathname();
  const router                 = useRouter();
  const { t, locale }          = useTranslation();
  const { sidebarOpen, setSidebarOpen } = useAppStore();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  const panelProps: PanelProps = {
    expanded: sidebarOpen,
    locale,
    t,
    pathname,
    onToggle:  () => setSidebarOpen(!sidebarOpen),
    onLogout:  handleLogout,
  };

  return (
    <>
      {/* ── Desktop sidebar ─────────────────────────────────────────────────
          Always in the flex row on lg+. Never rendered on mobile.
          `hidden lg:flex` is unambiguous — no competing display classes.
          `sticky top-0 h-screen` keeps it on screen while the page scrolls.
      ─────────────────────────────────────────────────────────────────── */}
      <aside
        className={cn(
          "hidden lg:flex flex-col",          // only enter flex flow on lg+
          "sticky top-0 h-screen shrink-0",   // fixed to viewport while scrolling
          "bg-white border-e border-ink-200",
          "transition-[width] duration-200 ease-in-out",
          "z-30 overflow-hidden",
          sidebarOpen ? "w-[260px]" : "w-[72px]"
        )}
      >
        <SidebarPanel {...panelProps} />
      </aside>

      {/* ── Mobile overlay + drawer ──────────────────────────────────────────
          Only rendered when the user explicitly opens the menu on mobile.
          Both elements are `fixed` so they never participate in the flex row.
          Hidden entirely on lg+ via `lg:hidden`.
      ─────────────────────────────────────────────────────────────────── */}
      {sidebarOpen && (
        <>
          {/* Scrim */}
          <div
            className="fixed inset-0 z-20 bg-black/40 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />

          {/* Drawer — always full-width on mobile */}
          <aside
            className={cn(
              "fixed inset-y-0 start-0 z-30 w-[260px]",
              "flex flex-col",
              "bg-white border-e border-ink-200",
              "lg:hidden"
            )}
          >
            <SidebarPanel {...panelProps} expanded={true} />
          </aside>
        </>
      )}
    </>
  );
}
