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
  { base: "chains.total",                  token: "{count}", converted: true },
  { base: "places.total",                  token: "{count}", converted: true },
  { base: "products.total",                token: "{count}", converted: true },
  { base: "placeProducts.total",           token: "{count}", converted: true },
  { base: "schedule.total",                token: "{count}", converted: true },
  { base: "visits.productsChecked",        token: "{n}",     converted: true },
  { base: "visits.ready.fields",           token: "{n}",     converted: true },
  { base: "visits.ready.reqProducts",      token: "{n}",     converted: true },
  { base: "visits.ready.unchecked",        token: "{n}",     converted: true },
  { base: "visits.ready.belowMin",         token: "{n}",     converted: true },
  { base: "visits.unsaved.products",       token: "{n}",     converted: true },
  { base: "visits.unsaved.responses",      token: "{n}",     converted: true },
  { base: "visits.plan.missingRequired",   token: "{n}",     converted: true },
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
// The dashboard, the list footers, the visit-completion flow and the visit plan
// panel all have plural forms now, so none of them may use it. Three are left:
// visits.ctx.lastVisit, one reports label that needs splitting because it doubles
// as an export column header, and one dead key. The ceiling below lets that
// number fall but never rise, so a new counted label cannot quietly join them.
{
  const PARENTHESISED = /\((?:e?s)\)/;
  const all = Object.entries(en).filter(([, v]) => PARENTHESISED.test(v)).map(([k]) => k);

  eq("no dashboard label falls back to a parenthesised plural",
     all.filter((k) => k.startsWith("dashboard.")), []);

  const KNOWN_BACKLOG = 3;
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

// ── No visit-completion label may interpolate a count without plural forms ───
// These all render inside CompleteModal, where the counts are small — one or
// two outstanding products is the common case, not the edge — so a fixed plural
// noun is wrong most of the time it is seen.
{
  const FAMILIES = ["visits.ready.", "visits.unsaved."];
  for (const [dictName, dict] of [["ar", ar], ["en", en]] as const) {
    const offenders = Object.keys(dict).filter(
      (k) =>
        FAMILIES.some((f) => k.startsWith(f)) &&
        dict[k].includes("{n}") &&
        !CATEGORIES.some((c) => k.endsWith(`.${c}`)),
    );
    eq(`${dictName}: no visits.ready.*/visits.unsaved.* label interpolates {n} without plural forms`,
       offenders, []);
  }
}

// ── The gap keys CompleteModal composes must all resolve ─────────────────────
// GAP_KEY holds bases, and the component appends a category for every kind
// except gps_missing. A base with no key set would render the key itself.
{
  const COUNTED_GAPS = [
    "visits.ready.fields",
    "visits.ready.reqProducts",
    "visits.ready.unchecked",
  ];
  for (const base of COUNTED_GAPS) {
    for (let i = 1; i <= 30; i++) {
      ok(`${base} resolves at ${i} (ar)`, typeof ar[pluralKey(base, i, "ar")] === "string");
      ok(`${base} resolves at ${i} (en)`, typeof en[pluralKey(base, i, "en")] === "string");
    }
  }
  ok("gps_missing stays a plain key with no count",
     typeof ar["visits.ready.gpsMissing"] === "string" &&
     !ar["visits.ready.gpsMissing"].includes("{n}"),
     ar["visits.ready.gpsMissing"]);
}

// ── The single-item cases these labels are usually seen at ───────────────────
eq("one outstanding required field reads as a singular in Arabic",
   ar[pluralKey("visits.ready.fields", 1, "ar")], "حقل إلزامي واحد بلا إجابة");
eq("and in English",
   en[pluralKey("visits.ready.fields", 1, "en")], "1 required field unanswered");
eq("one edited answer takes the Arabic feminine singular",
   ar[pluralKey("visits.unsaved.responses", 1, "ar")], "إجابة واحدة معدَّلة");
eq("two edited products take the Arabic dual",
   ar[pluralKey("visits.unsaved.products", 2, "ar")], "منتجان معدَّلان");

// ── visits.plan.missingRequired — Group C ────────────────────────────────────
// One call site, in VisitPlanPanel. It previously read "3 حقل إلزامي بلا إجابة"
// on the visit detail page while the completion modal, already converted in
// Group B, read "3 حقول إلزامية" for the same count on the same screen.
{
  const BASE = "visits.plan.missingRequired";

  // every category, both dictionaries
  for (const c of CATEGORIES) {
    ok(`ar has ${BASE}.${c}`, typeof ar[`${BASE}.${c}`] === "string" && ar[`${BASE}.${c}`].length > 0);
    ok(`en has ${BASE}.${c}`, typeof en[`${BASE}.${c}`] === "string" && en[`${BASE}.${c}`].length > 0);
  }

  // representative categories resolve to the right key
  eq(`${BASE} 0 -> zero (ar)`,  pluralKey(BASE, 0, "ar"),   `${BASE}.zero`);
  eq(`${BASE} 1 -> one (ar)`,   pluralKey(BASE, 1, "ar"),   `${BASE}.one`);
  eq(`${BASE} 2 -> two (ar)`,   pluralKey(BASE, 2, "ar"),   `${BASE}.two`);
  eq(`${BASE} 3 -> few (ar)`,   pluralKey(BASE, 3, "ar"),   `${BASE}.few`);
  eq(`${BASE} 11 -> many (ar)`, pluralKey(BASE, 11, "ar"),  `${BASE}.many`);
  eq(`${BASE} 100 -> other (ar)`, pluralKey(BASE, 100, "ar"), `${BASE}.other`);
  eq(`${BASE} 1 -> one (en)`,   pluralKey(BASE, 1, "en"),   `${BASE}.one`);
  eq(`${BASE} 3 -> other (en)`, pluralKey(BASE, 3, "en"),   `${BASE}.other`);

  // the exact strings the panel renders at the counts seen in production
  eq("three outstanding required fields, Arabic",
     ar[pluralKey(BASE, 3, "ar")], "{n} حقول إلزامية بلا إجابة");
  eq("one outstanding required field, Arabic",
     ar[pluralKey(BASE, 1, "ar")], "حقل إلزامي واحد بلا إجابة");
  eq("one outstanding required field, English",
     en[pluralKey(BASE, 1, "en")], "1 required field unanswered");

  // 0..120 sweep: raw keys, missing translations, parenthesised text, and a
  // singular that still says "fields" would all surface here.
  const problems: Array<{ n: number; lang: string; why: string; got: string }> = [];
  for (let i = 0; i <= 120; i++) {
    for (const [lang, dict] of [["ar", ar], ["en", en]] as const) {
      const key = pluralKey(BASE, i, lang);
      const val = dict[key];
      if (typeof val !== "string") { problems.push({ n: i, lang, why: "missing", got: key }); continue; }
      if (val === key) problems.push({ n: i, lang, why: "raw key", got: val });
      if (/\((?:e?s)\)/.test(val)) problems.push({ n: i, lang, why: "parenthesised", got: val });
      if (lang === "en" && i === 1 && /\bfields\b/.test(val))
        problems.push({ n: i, lang, why: "plural noun on a singular count", got: val });
      if (lang === "ar" && (i === 1 || i === 2) && val.includes("{n}"))
        problems.push({ n: i, lang, why: "numeral token in singular/dual", got: val });
    }
  }
  eq(`${BASE}: counts 0-120 clean in both languages`, problems, []);

  // The un-suffixed key is covered by the shared PLURAL_SETS guard above. What
  // that guard cannot see is whether this label was pointed at Group B's twin
  // instead of getting its own set — the two read identically today, so a
  // future wording change to one would silently move the other.
  for (const c of CATEGORIES) {
    ok(`visits.ready.fields.${c} still has its own entry`,
       typeof ar[`visits.ready.fields.${c}`] === "string");
  }
}

// ── No list-footer total may interpolate a count without plural forms ────────
// `.total` is a suffix rather than a prefix, so this cannot ride the family
// loop above. A new `foo.total` carrying {count} fails here instead of shipping
// as "1 branch" in a language that wants "branch one".
{
  for (const [dictName, dict] of [["ar", ar], ["en", en]] as const) {
    const offenders = Object.keys(dict).filter(
      (k) => k.endsWith(".total") && dict[k].includes("{count}"),
    );
    eq(`${dictName}: no *.total label interpolates {count} without plural forms`,
       offenders, []);
  }
}

// ── The dead keys Group A removed stay removed ───────────────────────────────
for (const dead of ["users.total", "visits.total"]) {
  ok(`${dead} is gone from ar`, ar[dead] === undefined, ar[dead]);
  ok(`${dead} is gone from en`, en[dead] === undefined, en[dead]);
}

// ── The production case that prompted Group A ────────────────────────────────
eq("a single branch in a filtered list reads as a singular in Arabic",
   ar[pluralKey("places.total", 1, "ar")], "فرع واحد");
eq("and as a singular in English",
   en[pluralKey("places.total", 1, "en")], "1 branch");
eq("two branches take the Arabic dual",
   ar[pluralKey("places.total", 2, "ar")], "فرعان");

// ── Dictionary parity ────────────────────────────────────────────────────────
{
  const arKeys = Object.keys(ar).sort();
  const enKeys = Object.keys(en).sort();
  eq("ar and en have the same number of keys", arKeys.length, enKeys.length);
  eq("ar has no key en lacks", arKeys.filter((k) => !(k in en)), []);
  eq("en has no key ar lacks", enKeys.filter((k) => !(k in ar)), []);
}
