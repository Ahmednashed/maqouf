"use client";

/**
 * ServiceWorkerRegistration
 *
 * Registers /sw.js on mount.  Renders nothing — pure side-effect component.
 *
 * We register from a React component (rather than directly in a script) so
 * the registration runs after hydration, avoids SSR mismatches, and stays
 * within the existing module system.
 *
 * The SW's scope is / (served from the public root), so it covers all routes.
 */

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator)
    ) {
      return;
    }

    // Register after the page has fully loaded so the SW installation
    // doesn't compete with the initial page resources.
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((registration) => {
          if (process.env.NODE_ENV === "development") {
            console.log("[SW] registered — scope:", registration.scope);
          }

          // When the SW has a new version waiting, reload once to activate it.
          registration.addEventListener("updatefound", () => {
            const newWorker = registration.installing;
            if (!newWorker) return;
            newWorker.addEventListener("statechange", () => {
              if (
                newWorker.state === "installed" &&
                navigator.serviceWorker.controller
              ) {
                // A new version is waiting.  Post a message so it can skip
                // the wait, then reload to give users the latest build.
                newWorker.postMessage({ type: "SKIP_WAITING" });
                window.location.reload();
              }
            });
          });
        })
        .catch((err) => {
          // Registration failure is non-fatal — app works without the SW.
          console.warn("[SW] registration failed:", err);
        });
    });
  }, []);

  return null;
}
