import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Locale } from "@/types";

interface AppState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;

  /**
   * DESKTOP ONLY (lg+). Whether the rail shows labels (260px) or icons
   * only (72px). Never controls the mobile drawer — see mobileNavOpen.
   */
  sidebarExpanded: boolean;
  setSidebarExpanded: (expanded: boolean) => void;

  /**
   * MOBILE ONLY (below lg). Whether the overlay drawer is showing.
   *
   * Deliberately separate from sidebarExpanded and deliberately NOT
   * persisted: a single flag used to drive both, defaulting to "open",
   * meant the drawer and its scrim covered the page on every load below
   * lg and swallowed clicks until dismissed. A drawer is a transient
   * response to a tap, so it always starts closed.
   */
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      locale: "ar",
      setLocale: (locale) => set({ locale }),
      toggleLocale: () =>
        set({ locale: get().locale === "ar" ? "en" : "ar" }),

      sidebarExpanded: true,
      setSidebarExpanded: (expanded) => set({ sidebarExpanded: expanded }),

      mobileNavOpen: false,
      setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
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
