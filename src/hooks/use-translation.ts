"use client";
import { useAppStore } from "@/store/app-store";
import { translations, type TranslationKey } from "@/lib/i18n/translations";

/**
 * The exact type of the `t` function returned by useTranslation().
 * Use this when a child component needs to accept `t` as a prop.
 * Prefer calling useTranslation() directly inside the component when possible.
 */
export type TranslationFn = (
  key:   TranslationKey,
  vars?: Record<string, string | number>
) => string;

export function useTranslation() {
  const locale = useAppStore((s) => s.locale);

  function t(key: TranslationKey, vars?: Record<string, string | number>): string {
    const dict = translations[locale] as Record<string, string>;
    let str = dict[key] ?? (translations.ar as Record<string, string>)[key] ?? key;
    if (vars) {
      Object.entries(vars).forEach(([k, v]) => {
        str = str.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
      });
    }
    return str;
  }

  return { t, locale };
}
