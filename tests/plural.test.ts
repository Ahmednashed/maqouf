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
  { base: "visits.tf.requiredLeft",        token: "{n}",     converted: true },
  { base: "visits.ctx.lastVisit",          token: "{n}",     converted: true },
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
  // The count has to be spelled out as a literal 1, not dropped and not left as
  // the token. It does NOT have to lead: every label up to Group D happened to
  // be count-first ("1 product edited"), but "Last visited 1 day ago" puts the
  // numeral mid-sentence, which is the natural English for an elapsed period.
  ok(`${base}: english singular states a literal 1`,
     /(^|\s)1\s/.test(en[`${base}.one`]), en[`${base}.one`]);
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
// Every counted label the visit flow renders now has plural forms, so none of
// them may use it. Exactly one is left: reports.col.noBranchCoords, which needs
// a key split rather than a conversion because the same string is both the
// on-screen warning and an Excel export column header. The ceiling below lets
// that number fall but never rise, so a new counted label cannot quietly join it.
{
  const PARENTHESISED = /\((?:e?s)\)/;
  const all = Object.entries(en).filter(([, v]) => PARENTHESISED.test(v)).map(([k]) => k);

  eq("no dashboard label falls back to a parenthesised plural",
     all.filter((k) => k.startsWith("dashboard.")), []);

  const KNOWN_BACKLOG = 1;
  ok(`parenthesised plurals outside the dashboard do not increase (${all.length} <= ${KNOWN_BACKLOG})`,
     all.length <= KNOWN_BACKLOG,
     all.join(", "));

  // A ceiling alone would still pass if the survivor were swapped for a new
  // offender, so pin which key it actually is.
  eq("the only parenthesised plural left is the reports export-header key",
     all, ["reports.col.noBranchCoords"]);
}

// ── The counted labels the (s) ratchet structurally cannot see ───────────────
// visits.tf.requiredLeft read `3 إلزامي متبقٍ` in production for weeks and no
// test caught it, because the guard above looks for `(s)` in the English and
// the English here was `3 required left` — no parenthesis, nothing to match.
//
// The tell that generalises is a count token in a value whose key carries no
// plural forms. Not all of those are bugs: `{n} م`, `الحد الأدنى {n}` and
// `Qty: {n}` have no noun to agree with. So this is a ceiling, not a zero —
// it lets the number fall as labels get converted and fails if one is added.
{
  const COUNTED = /\{n\}|\{count\}/;
  const unpluralised = (dict: Record<string, string>) =>
    Object.keys(dict).filter(
      (k) => COUNTED.test(dict[k]) && !CATEGORIES.some((c) => k.endsWith(`.${c}`)),
    );

  const CEILING = 25;
  for (const [dictName, dict] of [["ar", ar], ["en", en]] as const) {
    const left = unpluralised(dict);
    ok(`${dictName}: counted labels without plural forms do not increase (${left.length} <= ${CEILING})`,
       left.length <= CEILING,
       left.join(", "));
  }

  // The two dictionaries have to stay in step: a label converted in one and
  // not the other would render a raw key for half the users.
  eq("the same labels are un-pluralised in both dictionaries",
     unpluralised(ar).sort(), unpluralised(en).sort());
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

// ── visits.tf.requiredLeft — Group D ─────────────────────────────────────────
// The badge in the template-form section header, one panel below the Group C
// label. Production verification of Group C found this one rendering
// `3 إلزامي متبقٍ` on the same screen, at the same count, as the label that had
// just been fixed. Arabic cannot agree without naming what is counted, so the
// forms below say حقل rather than leaving the noun elided.
{
  const BASE = "visits.tf.requiredLeft";

  // every category, both dictionaries
  for (const c of CATEGORIES) {
    ok(`ar has ${BASE}.${c}`, typeof ar[`${BASE}.${c}`] === "string" && ar[`${BASE}.${c}`].length > 0);
    ok(`en has ${BASE}.${c}`, typeof en[`${BASE}.${c}`] === "string" && en[`${BASE}.${c}`].length > 0);
  }

  // exact output at the representative counts
  eq("0 required left, Arabic",   ar[pluralKey(BASE, 0, "ar")],   "لا حقول إلزامية متبقية");
  eq("1 required left, Arabic",   ar[pluralKey(BASE, 1, "ar")],   "حقل إلزامي واحد متبقٍ");
  eq("2 required left, Arabic",   ar[pluralKey(BASE, 2, "ar")],   "حقلان إلزاميان متبقيان");
  eq("3 required left, Arabic",   ar[pluralKey(BASE, 3, "ar")],   "{n} حقول إلزامية متبقية");
  eq("11 required left, Arabic",  ar[pluralKey(BASE, 11, "ar")],  "{n} حقلاً إلزامياً متبقياً");
  eq("100 required left, Arabic", ar[pluralKey(BASE, 100, "ar")], "{n} حقل إلزامي متبقٍ");
  // English has only `one` and `other`, so 0 and 2 resolve to `other` — the
  // `.zero` and `.two` entries exist for symmetry but are unreachable here.
  eq("0 required left, English",   en[pluralKey(BASE, 0, "en")],   "{n} required fields left");
  eq("1 required left, English",   en[pluralKey(BASE, 1, "en")],   "1 required field left");
  eq("2 required left, English",   en[pluralKey(BASE, 2, "en")],   "{n} required fields left");
  eq("3 required left, English",   en[pluralKey(BASE, 3, "en")],   "{n} required fields left");
  eq("the unreachable English zero form is still sane",
     en[`${BASE}.zero`], "No required fields left");
  eq("and the unreachable English dual",
     en[`${BASE}.two`], "2 required fields left");
  eq("11 required left, English",  en[pluralKey(BASE, 11, "en")],  "{n} required fields left");
  eq("100 required left, English", en[pluralKey(BASE, 100, "en")], "{n} required fields left");

  // Arabic singular, dual, few, many and other must actually be distinct — a
  // key set copied six times would pass every presence check above.
  const arForms = CATEGORIES.map((c) => ar[`${BASE}.${c}`]);
  eq("the six Arabic forms are all different", new Set(arForms).size, 6);
  ok("the Arabic singular carries no numeral", !ar[`${BASE}.one`].includes("{n}"), ar[`${BASE}.one`]);
  ok("the Arabic dual carries no numeral",     !ar[`${BASE}.two`].includes("{n}"), ar[`${BASE}.two`]);
  ok("the Arabic zero carries no numeral",     !ar[`${BASE}.zero`].includes("{n}"), ar[`${BASE}.zero`]);

  // English agreement: the singular takes `field`, everything countable above
  // one takes `fields`.
  ok("English singular says field, not fields",
     /\b1 required field\b/.test(en[`${BASE}.one`]) && !/fields/.test(en[`${BASE}.one`]),
     en[`${BASE}.one`]);
  for (const c of ["two", "few", "many", "other"] as const) {
    ok(`English ${c} says fields`, /\bfields\b/.test(en[`${BASE}.${c}`]), en[`${BASE}.${c}`]);
  }

  // 0..120 sweep in both languages: raw keys, missing forms, parenthesised
  // fallbacks and a numeral stranded in a form that should not carry one.
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
      if (lang === "ar" && (i === 0 || i === 1 || i === 2) && val.includes("{n}"))
        problems.push({ n: i, lang, why: "numeral token in zero/singular/dual", got: val });
      // the substituted string is what the badge actually shows
      if (val.replace("{n}", String(i)).includes("{n}"))
        problems.push({ n: i, lang, why: "unresolved token after substitution", got: val });
    }
  }
  eq(`${BASE}: counts 0-120 clean in both languages`, problems, []);

  // Group C's label is a different key with different wording. They mean the
  // same thing today, which is exactly why they must not share a key set.
  ok("Group C's label is untouched and still distinct",
     ar["visits.plan.missingRequired.few"] === "{n} حقول إلزامية بلا إجابة" &&
     ar[`${BASE}.few`] !== ar["visits.plan.missingRequired.few"],
     ar[`${BASE}.few`]);
}

// ── visits.ctx.lastVisit — Group E ───────────────────────────────────────────
// The branch-history line in the create-visit modal. It read
// `Last visited {n} day(s) ago` — the last parenthesised plural outside reports.
//
// The count is whole days from the branch's last visit to the RIYADH business
// day (daysSinceIso, UTC-anchored). The call site is a three-way branch:
//
//   null -> visits.ctx.neverVisited
//   0    -> visits.ctx.lastVisitToday      (a separate key, left alone)
//   >= 1 -> visits.ctx.lastVisit           (this key)
//
// So the zero form below is UNREACHABLE through the only caller. It exists
// because the six-form architecture requires it, and it is worded so that it
// would still read correctly if a future caller ever reached it.
{
  const BASE = "visits.ctx.lastVisit";

  // every category, both dictionaries
  for (const c of CATEGORIES) {
    ok(`ar has ${BASE}.${c}`, typeof ar[`${BASE}.${c}`] === "string" && ar[`${BASE}.${c}`].length > 0);
    ok(`en has ${BASE}.${c}`, typeof en[`${BASE}.${c}`] === "string" && en[`${BASE}.${c}`].length > 0);
  }

  // exact output at the representative counts, Arabic
  eq("0 days, Arabic",   ar[pluralKey(BASE, 0, "ar")],   "آخر زيارة اليوم");
  eq("1 day, Arabic",    ar[pluralKey(BASE, 1, "ar")],   "آخر زيارة منذ يوم واحد");
  eq("2 days, Arabic",   ar[pluralKey(BASE, 2, "ar")],   "آخر زيارة منذ يومين");
  eq("3 days, Arabic",   ar[pluralKey(BASE, 3, "ar")],   "آخر زيارة منذ {n} أيام");
  eq("11 days, Arabic",  ar[pluralKey(BASE, 11, "ar")],  "آخر زيارة منذ {n} يوماً");
  eq("100 days, Arabic", ar[pluralKey(BASE, 100, "ar")], "آخر زيارة منذ {n} يوم");

  // English resolves only `one` and `other`, so 0, 2, 3, 11 and 100 all land
  // on the same form. That is correct, not a gap.
  eq("1 day, English",    en[pluralKey(BASE, 1, "en")],   "Last visited 1 day ago");
  eq("0 days, English",   en[pluralKey(BASE, 0, "en")],   "Last visited {n} days ago");
  eq("2 days, English",   en[pluralKey(BASE, 2, "en")],   "Last visited {n} days ago");
  eq("3 days, English",   en[pluralKey(BASE, 3, "en")],   "Last visited {n} days ago");
  eq("11 days, English",  en[pluralKey(BASE, 11, "en")],  "Last visited {n} days ago");
  eq("100 days, English", en[pluralKey(BASE, 100, "en")], "Last visited {n} days ago");
  eq("the unreachable English zero form is still sane",
     en[`${BASE}.zero`], "Last visited today");

  // Arabic day agreement: يوم / يومين / أيام / يوماً are the four distinct
  // shapes the noun takes, and 0/1/2 must not carry a numeral token.
  ok("singular uses يوم واحد", ar[`${BASE}.one`].includes("يوم واحد"), ar[`${BASE}.one`]);
  ok("dual uses يومين",       ar[`${BASE}.two`].includes("يومين"),   ar[`${BASE}.two`]);
  ok("few uses أيام",         ar[`${BASE}.few`].includes("أيام"),    ar[`${BASE}.few`]);
  ok("many uses يوماً",       ar[`${BASE}.many`].includes("يوماً"),  ar[`${BASE}.many`]);
  ok("other uses يوم",        ar[`${BASE}.other`].includes("يوم"),   ar[`${BASE}.other`]);
  for (const c of ["zero", "one", "two"] as const) {
    ok(`Arabic ${c} carries no numeral token`, !ar[`${BASE}.${c}`].includes("{n}"), ar[`${BASE}.${c}`]);
  }
  eq("the six Arabic forms are all different",
     new Set(CATEGORIES.map((c) => ar[`${BASE}.${c}`])).size, 6);

  // English agreement: `1 day`, never `1 days`; everything countable above one
  // takes `days`.
  ok("English singular says day, not days",
     /\b1 day\b/.test(en[`${BASE}.one`]) && !/\bdays\b/.test(en[`${BASE}.one`]),
     en[`${BASE}.one`]);
  for (const c of ["two", "few", "many", "other"] as const) {
    ok(`English ${c} says days`, /\bdays\b/.test(en[`${BASE}.${c}`]), en[`${BASE}.${c}`]);
  }

  // 0..120 sweep in both languages.
  const problems: Array<{ n: number; lang: string; why: string; got: string }> = [];
  for (let i = 0; i <= 120; i++) {
    for (const [lang, dict] of [["ar", ar], ["en", en]] as const) {
      const key = pluralKey(BASE, i, lang);
      const val = dict[key];
      if (typeof val !== "string") { problems.push({ n: i, lang, why: "missing", got: key }); continue; }
      if (val === key) problems.push({ n: i, lang, why: "raw key", got: val });
      if (/\((?:e?s)\)/.test(val)) problems.push({ n: i, lang, why: "parenthesised", got: val });
      if (lang === "en" && i === 1 && /\bdays\b/.test(val))
        problems.push({ n: i, lang, why: "plural noun on a singular count", got: val });
      if (lang === "ar" && i <= 2 && val.includes("{n}"))
        problems.push({ n: i, lang, why: "numeral token in zero/singular/dual", got: val });
      if (val.replace("{n}", String(i)).includes("{n}"))
        problems.push({ n: i, lang, why: "unresolved token after substitution", got: val });
    }
  }
  eq(`${BASE}: counts 0-120 clean in both languages`, problems, []);

  // The today case belongs to a different key and must survive untouched — the
  // ternary that picks between them is the reason zero is unreachable here.
  eq("visits.ctx.lastVisitToday is unchanged (ar)", ar["visits.ctx.lastVisitToday"], "زيارة اليوم");
  eq("visits.ctx.lastVisitToday is unchanged (en)", en["visits.ctx.lastVisitToday"], "Visited today");
  ok("and it carries no count of its own",
     !ar["visits.ctx.lastVisitToday"].includes("{n}") && !en["visits.ctx.lastVisitToday"].includes("{n}"));
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

// ── reports.gpsCoordsWarning is gone — Group F ───────────────────────────────
// This key was born dead. Commit 0c55d8c added it and, in the same commit,
// wired the on-screen warning to reports.col.noBranchCoords instead. It had no
// caller in that commit or any commit since, no dynamic reference, and no
// export or API consumer — the XLSX export uses the col.* key too. Rather than
// expand a label nothing can render into six plural forms, it was deleted.
//
// TranslationKey is `keyof typeof translations.ar`, so a surviving static
// caller would already have failed type-check; these guard the dictionaries.
{
  const DEAD = "reports.gpsCoordsWarning";
  const CATS = ["zero", "one", "two", "few", "many", "other"];

  ok(`${DEAD} is absent from ar`, ar[DEAD] === undefined, ar[DEAD]);
  ok(`${DEAD} is absent from en`, en[DEAD] === undefined, en[DEAD]);

  // It must not come back as plural forms either — deleting it was the point.
  for (const c of CATS) {
    ok(`${DEAD}.${c} does not exist in ar`, ar[`${DEAD}.${c}`] === undefined, ar[`${DEAD}.${c}`]);
    ok(`${DEAD}.${c} does not exist in en`, en[`${DEAD}.${c}`] === undefined, en[`${DEAD}.${c}`]);
  }
  eq("no key anywhere still starts with the dead base",
     Object.keys(ar).filter((k) => k.startsWith(DEAD)).concat(
     Object.keys(en).filter((k) => k.startsWith(DEAD))), []);

  // The neighbouring key is explicitly out of scope for this batch and must
  // survive byte-for-byte, including its parenthesised plural.
  eq("reports.col.noBranchCoords is unchanged (ar)",
     ar["reports.col.noBranchCoords"], "زيارة إلى فرع بلا إحداثيات");
  eq("reports.col.noBranchCoords is unchanged (en)",
     en["reports.col.noBranchCoords"], "visit(s) to a branch without coordinates");
}

// ── Dictionary parity ────────────────────────────────────────────────────────
{
  const arKeys = Object.keys(ar).sort();
  const enKeys = Object.keys(en).sort();
  eq("ar and en have the same number of keys", arKeys.length, enKeys.length);
  eq("ar has no key en lacks", arKeys.filter((k) => !(k in en)), []);
  eq("en has no key ar lacks", enKeys.filter((k) => !(k in ar)), []);
}
