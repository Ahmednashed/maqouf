// Arabic plural agreement — Batch 4 (template field counts) and Batch 22
// (the overdue-visits label).
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
eq("english 1 is one",    pluralCategory(1, "en"),   "one");
eq("english 2 is other",  pluralCategory(2, "en"),   "other");
eq("english 0 is other",  pluralCategory(0, "en"),   "other");
eq("english 11 is other", pluralCategory(11, "en"),  "other");

// ── pluralKey composes the dictionary key ────────────────────────────────────
eq("one", pluralKey("dashboard.prio.overdue", 1, "ar"), "dashboard.prio.overdue.one");
eq("two", pluralKey("dashboard.prio.overdue", 2, "ar"), "dashboard.prio.overdue.two");
eq("few", pluralKey("dashboard.prio.overdue", 6, "ar"), "dashboard.prio.overdue.few");
eq("many", pluralKey("dashboard.prio.overdue", 11, "ar"), "dashboard.prio.overdue.many");
eq("english one", pluralKey("dashboard.prio.overdue", 1, "en"), "dashboard.prio.overdue.one");
eq("english other", pluralKey("dashboard.prio.overdue", 5, "en"), "dashboard.prio.overdue.other");

// ── Every category resolves to a real key, in both dictionaries ──────────────
// The bug this guards: a category with no matching key renders the key itself.
const CATEGORIES = ["zero", "one", "two", "few", "many", "other"] as const;
const ar = translations.ar as Record<string, string>;
const en = translations.en as Record<string, string>;

for (const base of ["dashboard.prio.overdue", "templates.fieldCount"]) {
  for (const c of CATEGORIES) {
    const key = `${base}.${c}`;
    ok(`ar has ${key}`, typeof ar[key] === "string" && ar[key].length > 0);
    ok(`en has ${key}`, typeof en[key] === "string" && en[key].length > 0);
  }
}

// ── Every count from 0 to 120 lands on a key that exists ─────────────────────
{
  const missing: number[] = [];
  for (let n = 0; n <= 120; n++) {
    if (typeof ar[pluralKey("dashboard.prio.overdue", n, "ar")] !== "string") missing.push(n);
  }
  eq("no count between 0 and 120 resolves to a missing key", missing, []);
}

// ── The Arabic forms are actually different where they must be ───────────────
// A copy-paste that left all six identical would pass every test above.
{
  const forms = CATEGORIES.map((c) => ar[`dashboard.prio.overdue.${c}`]);
  ok("one differs from few", forms[1] !== forms[3], `${forms[1]} vs ${forms[3]}`);
  ok("two differs from few", forms[2] !== forms[3], `${forms[2]} vs ${forms[3]}`);
  ok("many differs from few", forms[4] !== forms[3], `${forms[4]} vs ${forms[3]}`);
  ok("the singular form carries no {n} placeholder",
     !ar["dashboard.prio.overdue.one"].includes("{n}"),
     ar["dashboard.prio.overdue.one"]);
  ok("the dual form carries no {n} placeholder",
     !ar["dashboard.prio.overdue.two"].includes("{n}"),
     ar["dashboard.prio.overdue.two"]);
  ok("few keeps the {n} placeholder",
     ar["dashboard.prio.overdue.few"].includes("{n}"),
     ar["dashboard.prio.overdue.few"]);
}

// ── The old non-plural key is gone ───────────────────────────────────────────
ok("the un-suffixed key no longer exists in ar",
   ar["dashboard.prio.overdue"] === undefined);
ok("the un-suffixed key no longer exists in en",
   en["dashboard.prio.overdue"] === undefined);

// ── Dictionary parity ────────────────────────────────────────────────────────
{
  const arKeys = Object.keys(ar).sort();
  const enKeys = Object.keys(en).sort();
  eq("ar and en have the same number of keys", arKeys.length, enKeys.length);
  eq("ar has no key en lacks", arKeys.filter((k) => !(k in en)), []);
  eq("en has no key ar lacks", enKeys.filter((k) => !(k in ar)), []);
}
