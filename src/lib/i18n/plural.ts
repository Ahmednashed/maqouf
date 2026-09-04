import type { TranslationFn } from "@/hooks/use-translation";
import type { TranslationKey } from "@/lib/i18n/translations";

/**
 * Arabic does not have one plural. It has six agreement forms, and picking the
 * wrong one reads as broken to a native speaker:
 *
 *   0        لا توجد حقول
 *   1        حقل واحد          (not "1 حقول")
 *   2        حقلان             (dual — a form English has no equivalent for)
 *   3–10     ٣ حقول
 *   11–99    ١١ حقلاً          (singular accusative, not the plural)
 *   100+     ١٠٠ حقل
 *
 * The counts were rendered as `{n} {"حقول"}`, which is only correct for 3–10.
 * Every template with a single field read "1 حقول".
 *
 * Categories come from Intl.PluralRules rather than hand-rolled ranges: it is
 * the same CLDR data the rest of the platform uses, so it stays right at the
 * boundaries (11, 100, 103…) without us maintaining them.
 */
export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

const CATEGORIES: PluralCategory[] = ["zero", "one", "two", "few", "many", "other"];

export function pluralCategory(count: number, locale: string): PluralCategory {
  try {
    const picked = new Intl.PluralRules(locale === "ar" ? "ar" : "en").select(count);
    // Guard the cast: an unexpected category falls back rather than indexing
    // a translation map with something that is not a key.
    return (CATEGORIES as string[]).includes(picked)
      ? (picked as PluralCategory)
      : "other";
  } catch {
    // Intl.PluralRules is everywhere we run, but a missing-ICU build would
    // otherwise take the whole page down over a label.
    return count === 1 ? "one" : "other";
  }
}

const FIELD_COUNT_KEY: Record<PluralCategory, TranslationKey> = {
  zero:  "templates.fieldCount.zero",
  one:   "templates.fieldCount.one",
  two:   "templates.fieldCount.two",
  few:   "templates.fieldCount.few",
  many:  "templates.fieldCount.many",
  other: "templates.fieldCount.other",
};

/**
 * "N fields" in a form that agrees with N. Returns the whole phrase — the
 * number is inside the translated string because Arabic puts it in different
 * places depending on the form, and 0/1/2 do not show a numeral at all.
 */
export function fieldCountLabel(count: number, locale: string, t: TranslationFn): string {
  return t(FIELD_COUNT_KEY[pluralCategory(count, locale)]).replace("{count}", String(count));
}

/**
 * The translation key for `base` in the form that agrees with `count`.
 *
 * Use this wherever a label interpolates a number into a noun. Arabic needs six
 * forms and English two, so the *key* has to vary, not just the substituted
 * value — `"{n} زيارات"` is only ever right for 3–10.
 *
 * The caller supplies the six keyed strings as `base.zero` … `base.other`, and
 * passes `count` through `msgVars` as usual so the numeral still lands inside
 * whichever form is chosen.
 */
export function pluralKey(base: string, count: number, locale: string): string {
  return `${base}.${pluralCategory(count, locale)}`;
}
