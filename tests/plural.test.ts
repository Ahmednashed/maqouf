// Arabic plural agreement — Batch 4 (template field counts), Batch 22 (the
// overdue-visits label) and Batch 23 (the remaining priority labels).
//
// Arabic has six agreement forms. Interpolating a number into one fixed noun
// phrase is only ever correct for 3–10, which is why `1 زيارات متأخرة` shipped
// and went unnoticed while the count happened to be 6.
//
// These pin the category boundaries, that a key set exists for every category
// in BOTH dictionaries, and that the forms differ where Arabic requires them to.

import { eq, ok } from "./_harness.ts";
import { pluralCategory, pluralKey } from "@/lib/i18n/plural";
import { translations } from "@/lib/i18n/translations";

/** Every base that resolves through pluralKey at runtime. */
const PLURAL_BASES = [
  "dashboard.prio.overdue",
  "dashboard.prio.syncMany",
  "dashboard.prio.oos",
  "templates.fieldCount",
];

/** The three that replaced a single un-suffixed key and must not leave it behind. */
const CONVERTED_BASES = [
  "dashboard.prio.overdue",
  "dashboard.prio.syncMany",
  "dashboard.prio.oos",
];

const CATEGORIES = ["zero", "one", "two", "few", "many", "other"] as const;
const ar = translations.ar as Record<string, string>;
const en = translations.en as Record<string, string>;

// ── Category boundaries, Arabic ──────────────────────────────────────────────
eq("0 is zero",        pluralCategory(0, "ar"),   "zero");
eq("1 is one",         pluralCategory(1, "ar"),   "one");
eq("2 is two (dual)",  pluralCategory(2, "ar"),   "two");
eq("3 is few",         pluralCategory(3, "ar"),   "few");
eq("10 is few",        pluralCategory(10, "ar"),  "few");
eq("11 is many",       pluralCategory(11, "ar"),  "many");
eq("99 is many",       pluralCategory(99, "ar"),  "many");
eq("100 is other",     pluralCategory(100, "ar"), "other");
eq("103 is few again", pluralCategory(103, "ar"), "few");

// ── English collapses to two ─────────────────────────────────────────────────
eq("english 1 is one",    pluralCategory(1, "en"),  "one");
eq("english 2 is other",  pluralCategory(2, "en"),  "other");
eq("english 0 is other",  pluralCategory(0, "en"),  "other");
eq("english 11 is other", pluralCategory(11, "en"), "other");

// ── pluralKey composes the dictionary key ────────────────────────────────────
eq("one",  pluralKey("dashboard.prio.overdue", 1, "ar"),  "dashboard.prio.overdue.one");
eq("two",  pluralKey("dashboard.prio.overdue", 2, "ar"),  "dashboard.prio.overdue.two");
eq("few",  pluralKey("dashboard.prio.overdue", 6, "ar"),  "dashboard.prio.overdue.few");
eq("many", pluralKey("dashboard.prio.overdue", 11, "ar"), "dashboard.prio.overdue.many");
eq("english one",   pluralKey("dashboard.prio.oos", 1, "en"), "dashboard.prio.oos.one");
eq("english other", pluralKey("dashboard.prio.oos", 5, "en"), "dashboard.prio.oos.other");

// ── Every category resolves to a real key, in both dictionaries ──────────────
// The bug this guards: a category with no matching key renders the key itself.
for (const base of PLURAL_BASES) {
  for (const c of CATEGORIES) {
    const key = `${base}.${c}`;
    ok(`ar has ${key}`, typeof ar[key] === "string" && ar[key].length > 0);
    ok(`en has ${key}`, typeof en[key] === "string" && en[key].length > 0);
  }
}

// ── Every count from 0 to 120 lands on a key that exists, in both languages ──
for (const base of PLURAL_BASES) {
  const missingAr: number[] = [];
  const missingEn: number[] = [];
  for (let n = 0; n <= 120; n++) {
    if (typeof ar[pluralKey(base, n, "ar")] !== "string") missingAr.push(n);
    if (typeof en[pluralKey(base, n, "en")] !== "string") missingEn.push(n);
  }
  eq(`${base}: every ar count 0-120 resolves`, missingAr, []);
  eq(`${base}: every en count 0-120 resolves`, missingEn, []);
}

// ── The Arabic forms are actually different where they must be ───────────────
// A copy-paste that left all six identical would pass every test above.
for (const base of CONVERTED_BASES) {
  const one = ar[`${base}.one`];
  const two = ar[`${base}.two`];
  const few = ar[`${base}.few`];
  const many = ar[`${base}.many`];
  ok(`${base}: one differs from few`,  one !== few,  `${one} vs ${few}`);
  ok(`${base}: two differs from few`,  two !== few,  `${two} vs ${few}`);
  ok(`${base}: many differs from few`, many !== few, `${many} vs ${few}`);
  ok(`${base}: singular carries no {n}`, !one.includes("{n}"), one);
  ok(`${base}: dual carries no {n}`,     !two.includes("{n}"), two);
  ok(`${base}: few keeps {n}`,            few.includes("{n}"), few);
}

// ── English singular must agree in number too ────────────────────────────────
// "1 overdue visits" and "1 report need review" are the English half of the
// same bug, and are easy to miss because English only has two forms.
ok("english overdue singular is singular",
   en["dashboard.prio.overdue.one"] === "1 overdue visit",
   en["dashboard.prio.overdue.one"]);
ok("english oos singular agrees its verb",
   /report needs review/.test(en["dashboard.prio.oos.one"]),
   en["dashboard.prio.oos.one"]);
ok("english syncMany singular agrees its verb",
   /user has not synced/.test(en["dashboard.prio.syncMany.one"]),
   en["dashboard.prio.syncMany.one"]);
for (const base of CONVERTED_BASES) {
  ok(`${base}: english one differs from other`,
     en[`${base}.one`] !== en[`${base}.other`],
     `${en[`${base}.one`]} vs ${en[`${base}.other`]}`);
}

// ── The old un-suffixed keys are gone ────────────────────────────────────────
for (const base of CONVERTED_BASES) {
  ok(`${base}: no un-suffixed key remains in ar`, ar[base] === undefined, ar[base]);
  ok(`${base}: no un-suffixed key remains in en`, en[base] === undefined, en[base]);
}

// ── No counted label is left interpolating into a fixed noun ─────────────────
// Any dashboard.prio.* key that still contains {n} must be a plural variant.
// A new counted label added without a key set would fail here.
{
  const offenders = Object.keys(ar).filter(
    (k) =>
      k.startsWith("dashboard.prio.") &&
      ar[k].includes("{n}") &&
      !CATEGORIES.some((c) => k.endsWith(`.${c}`)),
  );
  eq("no dashboard.prio.* label interpolates {n} without plural forms", offenders, []);
}

// ── Dictionary parity ────────────────────────────────────────────────────────
{
  const arKeys = Object.keys(ar).sort();
  const enKeys = Object.keys(en).sort();
  eq("ar and en have the same number of keys", arKeys.length, enKeys.length);
  eq("ar has no key en lacks", arKeys.filter((k) => !(k in en)), []);
  eq("en has no key ar lacks", enKeys.filter((k) => !(k in ar)), []);
}
