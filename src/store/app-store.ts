import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Locale } from "@/types";

interface AppState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      locale: "ar",
      setLocale: (locale) => set({ locale }),
      toggleLocale: () =>
        set({ locale: get().locale === "ar" ? "en" : "ar" }),
      sidebarOpen: true,
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
    }),
    {
      name:      "malgoof-app",
      partialize: (s) => ({ locale: s.locale }),
      /**
       * HYDRATION SAFETY (React #418).
       *
       * Without this, the persist middleware reads localStorage synchronously
       * while the module initialises. SSR always renders with the default
       * locale ("ar"), but an English user's FIRST client render would already
       * be "en" — so every translated string mismatched the server HTML and
       * React threw #418 across the whole dashboard.
       *
       * With skipHydration the first client render matches the server exactly;
       * <StoreHydration /> (mounted in the root layout) calls rehydrate() in an
       * effect, after which the persisted locale is applied.
       */
      skipHydration: true,
    }
  )
);
