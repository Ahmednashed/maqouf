"use client";

/**
 * GlobalOfflineBanner
 *
 * A thin fixed notification bar shown at the very top of the screen whenever
 * navigator.onLine is false.  Disappears automatically when the connection
 * is restored.
 *
 * Placement: fixed, z-[90], full width.
 * The app layout is not reflowed — the banner overlaps the topbar by design
 * (standard UX for connectivity banners, e.g. Gmail's "No internet" bar).
 *
 * Per-page offline UI (e.g. the amber inline banner on the visit detail page)
 * remains unchanged; this component adds a global layer on top.
 */

import { useState, useEffect } from "react";
import { WifiOff }             from "lucide-react";
import { useTranslation }      from "@/hooks/use-translation";

export function GlobalOfflineBanner() {
  const { t } = useTranslation();

  // Start as "online" to avoid a flash on hydration (navigator.onLine is
  // evaluated client-side only).
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    // Sync with actual state after mount.
    setIsOnline(navigator.onLine);

    const goOnline  = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online",  goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online",  goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={
        "fixed top-0 inset-x-0 z-[90] " +
        "flex items-center justify-center gap-2 " +
        "bg-amber-500 text-white " +
        "px-4 py-1.5 " +
        "text-[12px] font-semibold leading-none " +
        "shadow-md " +
        // Shift down by the iOS status-bar height in standalone/notch mode
        "pt-[max(6px,env(safe-area-inset-top))]"
      }
    >
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>{t("offline.banner")}</span>
    </div>
  );
}
