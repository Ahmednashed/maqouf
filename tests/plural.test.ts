// Arabic plural agreement — Batch 4 (template field counts), Batch 22 (the
// overdue-visits label), Batch 23 (the remaining priority labels) and Batch 24
// (the attention panel).
//
// Arabic has six agreement forms. Interpolating a number into one fixed noun
// phrase is only ever correct for 3–10, which is why `1 زيارات متأخرة` shipped
// and went unnoticed while the count happened to be 6, and why the attention
// panel read `1 فرع بدون تشكيلة منتجات` in production for weeks.
//
// These pin the category boundaries, that a key set exists for every category
// in BOTH dictionaries, and that the forms differ where Arabic requires them to.

import { eq, ok } from "./_harness.ts";
import { pluralCategory, pluralKey } from "@/lib/i18n/plural";
import { translations } from "@/lib/i18n/translations";

/**
 * Every base resolved through pluralKey at runtime.
 *
 * `token` differs by family: the priority labels interpolate `{n}`, the
 * attention panel and template counts use `{count}`. `converted` marks the ones
 * that replaced a single fixed string and must not leave it behind.
 */
const PLURAL_SETS: Array<{ base: string; token: string; converted: boolean }> = [
  { base: "dashboard.prio.overdue",        token: "{n}",     converted: true },
  { base: "dashboard.prio.syncMany",       token: "{n}",     converted: true },
  { base: "dashboard.prio.oos",            token: "{n}",     converted: true },
  { base: "dashboard.attn.neverVisited",   token: "{count}", converted: true },
  { base: "dashboard.attn.stale",          token: "{count}", converted: true },
  { base: "dashboard.attn.noAssortment",   token: "{count}", converted: true },
  { base: "dashboard.attn.unassigned",     token: "{count}", converted: true },
  { base: "dashboard.attn.orphanProducts", token: "{count}", converted: true },
  { base: "dashboard.attn.emptyTemplate",  token: "{count}", converted: true },
  { base: "dashboard.map.fixCoords",       token: "{n}",     converted: true },
  { base: "templates.fieldCount",          token: "{count}", converted: false },
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
eq("two",  pluralKey("dashboard.attn.noAssortment", 2, "ar"), "dashboard.attn.noAssortment.two");
eq("few",  pluralKey("dashboard.attn.stale", 6, "ar"),    "dashboard.attn.stale.few");
eq("many", pluralKey("dashboard.prio.overdue", 11, "ar"), "dashboard.prio.overdue.many");
eq("english one",   pluralKey("dashboard.prio.oos", 1, "en"), "dashboard.prio.oos.one");
eq("english other", pluralKey("dashboard.attn.unassigned", 5, "en"),
   "dashboard.attn.unassigned.other");

// ── Every category resolves to a real key, in both dictionaries ──────────────
// The bug this guards: a category with no matching key renders the key itself.
for (const { base } of PLURAL_SETS) {
  for (const c of CATEGORIES) {
    const key = `${base}.${c}`;
    ok(`ar has ${key}`, typeof ar[key] === "string" && ar[key].length > 0);
    ok(`en has ${key}`, typeof en[key] === "string" && en[key].length > 0);
  }
}

// ── Every count from 0 to 120 lands on a key that exists, in both languages ──
for (const { base } of PLURAL_SETS) {
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
for (const { base, token } of PLURAL_SETS.filter((s) => s.converted)) {
  const one = ar[`${base}.one`];
  const two = ar[`${base}.two`];
  const few = ar[`${base}.few`];
  const many = ar[`${base}.many`];
  ok(`${base}: one differs from few`,  one !== few,  `${one} vs ${few}`);
  ok(`${base}: two differs from few`,  two !== few,  `${two} vs ${few}`);
  ok(`${base}: many differs from few`, many !== few, `${many} vs ${few}`);
  ok(`${base}: singular carries no numeral token`, !one.includes(token), one);
  ok(`${base}: dual carries no numeral token`,     !two.includes(token), two);
  ok(`${base}: few keeps the numeral token`,        few.includes(token), few);
}

// ── English singular must agree in number too ────────────────────────────────
// "1 branches never visited" is the English half of the same bug, and is easy
// to miss because English only has two forms.
for (const { base, token } of PLURAL_SETS.filter((s) => s.converted)) {
  ok(`${base}: english one differs from other`,
     en[`${base}.one`] !== en[`${base}.other`],
     `${en[`${base}.one`]} vs ${en[`${base}.other`]}`);
  ok(`${base}: english singular carries no numeral token`,
     !en[`${base}.one`].includes(token), en[`${base}.one`]);
  ok(`${base}: english singular says "1 "`,
     en[`${base}.one`].startsWith("1 "), en[`${base}.one`]);
}
ok("english oos singular agrees its verb",
   /report needs review/.test(en["dashboard.prio.oos.one"]),
   en["dashboard.prio.oos.one"]);
ok("english syncMany singular agrees its verb",
   /user has not synced/.test(en["dashboard.prio.syncMany.one"]),
   en["dashboard.prio.syncMany.one"]);

// ── The production case that prompted Batch 24 ───────────────────────────────
eq("a single branch with no assortment reads as a singular in Arabic",
   ar[pluralKey("dashboard.attn.noAssortment", 1, "ar")],
   "فرع واحد بدون تشكيلة منتجات");

eq("two branches without coordinates reads as the Arabic dual",
   ar[pluralKey("dashboard.map.fixCoords", 2, "ar")],
   "فرعان بلا إحداثيات — أضفهما");
// "branch(es)" is the tell of a string that cannot agree with its count.
//
// Every dashboard label now has plural forms, so none of them may use it. The
// rest of the app still has 18, listed in the Batch 25 report and awaiting the
// wider triage — the ceiling below lets that number fall but never rise, so a
// new counted label cannot quietly join them.
{
  const PARENTHESISED = /\((?:e?s)\)/;
  const all = Object.entries(en).filter(([, v]) => PARENTHESISED.test(v)).map(([k]) => k);

  eq("no dashboard label falls back to a parenthesised plural",
     all.filter((k) => k.startsWith("dashboard.")), []);

  const KNOWN_BACKLOG = 18;
  ok(`parenthesised plurals outside the dashboard do not increase (${all.length} <= ${KNOWN_BACKLOG})`,
     all.length <= KNOWN_BACKLOG,
     all.join(", "));
}

// ── The old un-suffixed keys are gone ────────────────────────────────────────
for (const { base } of PLURAL_SETS.filter((s) => s.converted)) {
  ok(`${base}: no un-suffixed key remains in ar`, ar[base] === undefined, ar[base]);
  ok(`${base}: no un-suffixed key remains in en`, en[base] === undefined, en[base]);
}

// ── No counted label is left interpolating into a fixed noun ─────────────────
// Any dashboard.prio.* or dashboard.attn.* key that still contains a numeral
// token must be a plural variant. A counted label added later without a key set
// fails here rather than shipping.
for (const [family, token] of [
  ["dashboard.prio.", "{n}"],
  ["dashboard.attn.", "{count}"],
  ["dashboard.map.",  "{n}"],
]) {
  for (const [dictName, dict] of [["ar", ar], ["en", en]] as const) {
    const offenders = Object.keys(dict).filter(
      (k) =>
        k.startsWith(family) &&
        dict[k].includes(token) &&
        !CATEGORIES.some((c) => k.endsWith(`.${c}`)),
    );
    eq(`${dictName}: no ${family}* label interpolates ${token} without plural forms`,
       offenders, []);
  }
}

// ── Dictionary parity ────────────────────────────────────────────────────────
{
  const arKeys = Object.keys(ar).sort();
  const enKeys = Object.keys(en).sort();
  eq("ar and en have the same number of keys", arKeys.length, enKeys.length);
  eq("ar has no key en lacks", arKeys.filter((k) => !(k in en)), []);
  eq("en has no key ar lacks", enKeys.filter((k) => !(k in ar)), []);
}
