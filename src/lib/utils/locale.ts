import type { Locale, Dir } from "@/types";

export const LOCALES: Locale[] = ["ar", "en"];
export const DEFAULT_LOCALE: Locale = "ar";

export function getDir(locale: Locale): Dir {
  return locale === "ar" ? "rtl" : "ltr";
}

export function getLocaleFromCookie(): Locale {
  if (typeof document === "undefined") return DEFAULT_LOCALE;
  const match = document.cookie.match(/(?:^|;\s*)locale=([^;]*)/);
  const val = match?.[1] as Locale | undefined;
  return val && LOCALES.includes(val) ? val : DEFAULT_LOCALE;
}
