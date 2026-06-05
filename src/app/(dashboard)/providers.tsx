"use client";

import { useState }              from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster }               from "sonner";
import { useAppStore }           from "@/store/app-store";
import { ServiceWorkerRegistration } from "@/components/pwa/ServiceWorkerRegistration";
import { GlobalOfflineBanner }   from "@/components/pwa/GlobalOfflineBanner";
import { InstallPrompt }         from "@/components/pwa/InstallPrompt";

// Each browser tab gets its own QueryClient.
// Created inside useState so it's stable across re-renders.
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Data stays fresh for 60 s before a background refetch.
            staleTime: 60_000,
            // Retry once on failure before surfacing the error.
            retry: 1,
          },
        },
      }),
  );

  const locale = useAppStore((s) => s.locale);

  return (
    <QueryClientProvider client={queryClient}>
      {/* ── PWA: service worker ──────────────────────────────────── */}
      <ServiceWorkerRegistration />

      {/* ── PWA: global offline banner (fixed top bar) ───────────── */}
      <GlobalOfflineBanner />

      {/* ── PWA: install prompt (bottom sheet, dismissible) ─────── */}
      <InstallPrompt />

      {children}

      {/* ── Toaster: RTL-aware positioning ──────────────────────── */}
      <Toaster
        position={locale === "ar" ? "bottom-right" : "bottom-left"}
        richColors
        closeButton
        duration={3500}
      />
    </QueryClientProvider>
  );
}
