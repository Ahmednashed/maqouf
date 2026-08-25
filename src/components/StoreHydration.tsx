"use client";

import { useEffect } from "react";
import { useAppStore } from "@/store/app-store";

/**
 * Applies the persisted Zustand state (locale) exactly once, after mount.
 *
 * The store is configured with `skipHydration: true` so the first client
 * render is byte-identical to the server render — that is what removes React
 * hydration error #418. Reading localStorage is deferred to this effect,
 * which runs after hydration has completed.
 *
 * Mounted once in the root layout so it covers both the dashboard and the
 * public auth pages.
 */
export function StoreHydration() {
  useEffect(() => {
    void useAppStore.persist.rehydrate();
  }, []);

  return null;
}
