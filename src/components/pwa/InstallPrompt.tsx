"use client";

/**
 * InstallPrompt
 *
 * Shows a bottom-sheet install prompt when the browser fires
 * `beforeinstallprompt` (Chrome/Edge on Android and desktop).
 *
 * iOS Safari does not fire this event — iOS users see the normal "Add to
 * Home Screen" option in the Share sheet.
 *
 * Dismissal behaviour
 * ───────────────────
 * When the user dismisses the prompt (× button), the dismissal timestamp is
 * saved in localStorage under `malgoof_pwa_install_dismissed_at`.
 * The prompt is not shown again for SNOOZE_DAYS (30) days.
 *
 * The component renders null when:
 *   • The browser does not support `beforeinstallprompt`.
 *   • The app is already installed (display-mode: standalone).
 *   • The user dismissed within the last 30 days.
 */

import { useState, useEffect } from "react";
import { Download, X }         from "lucide-react";
import { cn }                  from "@/lib/utils/cn";
import { useTranslation }      from "@/hooks/use-translation";

// ─── BeforeInstallPromptEvent type ────────────────────────────────────────────
// The standard TypeScript lib does not include this event yet.

interface BeforeInstallPromptEvent extends Event {
  prompt():                   Promise<void>;
  readonly userChoice:        Promise<{ outcome: "accepted" | "dismissed" }>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY  = "malgoof_pwa_install_dismissed_at";
const SNOOZE_DAYS  = 30;

// ─── Component ────────────────────────────────────────────────────────────────

export function InstallPrompt() {
  const { t, locale } = useTranslation();
  const isRtl         = locale === "ar";

  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Never show if already running as a standalone installed PWA.
    if (window.matchMedia("(display-mode: standalone)").matches) return;
    // Never show if dismissed recently.
    const dismissedAt = localStorage.getItem(STORAGE_KEY);
    if (dismissedAt) {
      const daysSince =
        (Date.now() - Number(dismissedAt)) / (1000 * 60 * 60 * 24);
      if (daysSince < SNOOZE_DAYS) return;
    }

    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault(); // suppress the browser's mini-infobar
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      // Small delay so the prompt doesn't flash immediately on page load.
      setTimeout(() => setVisible(true), 3000);
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () =>
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);

  // Clean up after the app is installed (hides the prompt).
  useEffect(() => {
    function onInstalled() {
      setVisible(false);
      setDeferredPrompt(null);
    }
    window.addEventListener("appinstalled", onInstalled);
    return () => window.removeEventListener("appinstalled", onInstalled);
  }, []);

  async function handleInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setVisible(false);
    }
    setDeferredPrompt(null);
  }

  function handleDismiss() {
    localStorage.setItem(STORAGE_KEY, String(Date.now()));
    setVisible(false);
  }

  if (!visible || !deferredPrompt) return null;

  return (
    // Slide-up card anchored to the bottom of the screen.
    <div
      role="dialog"
      aria-label={locale === "ar" ? "تثبيت التطبيق" : "Install app"}
      className={cn(
        "fixed bottom-4 inset-x-4 z-50",
        "bg-white rounded-2xl shadow-modal border border-ink-100",
        "p-4 animate-slide-up",
        // Keep above the sticky visit action bar (z-40)
      )}
      dir={isRtl ? "rtl" : "ltr"}
    >
      <div className="flex items-start gap-3">
        {/* App icon */}
        <div className="w-12 h-12 rounded-2xl bg-brand-500 flex items-center justify-center shrink-0">
          <span className="text-white font-bold text-[18px]">م</span>
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-bold text-ink-900 leading-snug">
            {locale === "ar" ? "تثبيت تطبيق ملقوف" : "Install Malgoof"}
          </p>
          <p className="text-[12px] text-ink-500 mt-0.5 leading-snug">
            {locale === "ar"
              ? "أضفه لشاشتك الرئيسية للوصول السريع في الميدان"
              : "Add to your Home Screen for quick field access"}
          </p>
        </div>

        {/* Dismiss */}
        <button
          type="button"
          onClick={handleDismiss}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-ink-400 hover:bg-ink-100 transition-colors shrink-0"
          aria-label={locale === "ar" ? "إغلاق" : "Dismiss"}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 mt-3">
        <button
          type="button"
          onClick={handleDismiss}
          className={cn(
            "flex-1 h-10 rounded-xl border border-ink-200",
            "text-ink-600 text-[13px] font-semibold",
            "hover:bg-ink-50 transition-all",
          )}
        >
          {locale === "ar" ? "لاحقاً" : "Not now"}
        </button>
        <button
          type="button"
          onClick={handleInstall}
          className={cn(
            "flex-1 h-10 rounded-xl bg-brand-500 hover:bg-brand-600",
            "text-white text-[13px] font-semibold",
            "shadow-pop transition-all",
            "flex items-center justify-center gap-1.5",
          )}
        >
          <Download className="w-4 h-4" />
          {locale === "ar" ? "تثبيت" : "Install"}
        </button>
      </div>

      {/* Bottom safe-area spacer so the card clears the home-indicator bar */}
      <div style={{ height: "env(safe-area-inset-bottom, 0px)" }} />
    </div>
  );
}
