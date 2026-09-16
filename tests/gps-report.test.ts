// GPS compliance report — the export header and the on-screen warning (Group G).
//
// reports.col.noBranchCoords used to be both the Excel column header and, with
// a count prepended in JSX, the warning under the "No GPS recorded" cell. These
// pin the split: the export still writes the same number under the same column,
// and the screen resolves its own plural key and never touches the header.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { check, eq, ok } from "./_harness.ts";
import { gpsExportRow, gpsNoBranchCoordsWarning } from "@/lib/gps-report";
import { translations, type TranslationKey } from "@/lib/i18n/translations";
import type { TranslationFn } from "@/hooks/use-translation";
import type { GpsReportRow } from "@/services/reports";

/** The same lookup useTranslation() performs, without the store. */
function tFor(locale: "ar" | "en"): TranslationFn {
  const dict = translations[locale] as Record<string, string>;
  const fallback = translations.ar as Record<string, string>;
  return (key, vars) => {
    let str = dict[key] ?? fallback[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        str = str.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
      }
    }
    return str;
  };
}

/** Returns the key itself and records every key it was asked for. */
function recordingT(): { t: TranslationFn; keys: TranslationKey[] } {
  const keys: TranslationKey[] = [];
  return { keys, t: (key) => { keys.push(key); return key; } };
}

const row: GpsReportRow = {
  merch_id:          "m1",
  full_name:         "TEST Merch",
  total_started:     9,
  gps_verified:      4,
  gps_outside:       1,
  gps_not_recorded:  4,
  no_branch_coords:  3,
  verification_rate: 80,
  avg_distance:      42,
};

const COLUMNS: TranslationKey[] = [
  "reports.col.merch",
  "reports.col.totalStarted",
  "reports.col.gpsVerified",
  "reports.col.gpsOutside",
  "reports.col.gpsNotRecorded",
  "reports.col.noBranchCoords",
  "reports.col.gpsRate",
  "reports.col.avgDistance",
];

console.log("1) the export keeps its columns, order and values");
{
  const { t } = recordingT();
  const out = gpsExportRow(row, t);

  // json_to_sheet takes columns from key order, so this IS the column order.
  eq("eight columns, in the original order", Object.keys(out), COLUMNS);
  eq("no-coordinates is still the sixth column", Object.keys(out).indexOf("reports.col.noBranchCoords"), 5);
  eq("under it: the raw visit count, as a number", out["reports.col.noBranchCoords"], 3);
  check("and it is a number, not a sentence", typeof out["reports.col.noBranchCoords"] === "number");

  eq("the other values are unchanged", out, {
    "reports.col.merch":          "TEST Merch",
    "reports.col.totalStarted":   9,
    "reports.col.gpsVerified":    4,
    "reports.col.gpsOutside":     1,
    "reports.col.gpsNotRecorded": 4,
    "reports.col.noBranchCoords": 3,
    "reports.col.gpsRate":        "80%",
    "reports.col.avgDistance":    42,
  });

  const unmeasured = gpsExportRow({ ...row, verification_rate: null, avg_distance: null }, t);
  eq("no measurement exports an empty rate, not 0%", unmeasured["reports.col.gpsRate"], "");
  eq("no distance exports empty", unmeasured["reports.col.avgDistance"], "");

  const zero = gpsExportRow({ ...row, no_branch_coords: 0 }, t);
  eq("a zero count still exports as 0 under the same column", zero["reports.col.noBranchCoords"], 0);
}

console.log("2) the export path reads the header key, and only header keys");
{
  const { t, keys } = recordingT();
  gpsExportRow(row, t);
  check("the export asks for reports.col.noBranchCoords", keys.includes("reports.col.noBranchCoords"), keys);
  eq("the export asks for nothing but column headers", keys.filter((k) => !k.startsWith("reports.col.")), []);
  eq("the export never asks for the warning", keys.filter((k) => k.startsWith("reports.gpsNoBranchCoords")), []);
}

console.log("3) real headers are count-free and distinct in both languages");
for (const locale of ["ar", "en"] as const) {
  const t = tFor(locale);
  const out = gpsExportRow(row, t);
  const headers = Object.keys(out);

  // Two equal headers would collapse into one column and lose data.
  eq(`${locale}: eight distinct headers`, new Set(headers).size, 8);
  eq(`${locale}: the sixth header is the no-coordinates heading`, headers[5], t("reports.col.noBranchCoords"));
  eq(`${locale}: which still holds the number`, out[headers[5]], 3);
  ok(`${locale}: that heading carries no count token`, !/\{n\}|\{count\}/.test(headers[5]), headers[5]);
  ok(`${locale}: that heading has no parenthesised plural`, !/\((?:e?s)\)/.test(headers[5]), headers[5]);
  ok(`${locale}: that heading is not a raw key`, !headers[5].startsWith("reports."), headers[5]);
}

console.log("4) the warning resolves its own plural key");
{
  for (const n of [0, 1, 2, 3, 11, 100]) {
    const { t, keys } = recordingT();
    gpsNoBranchCoordsWarning(n, "ar", t);
    eq(`ar ${n}: one lookup, under reports.gpsNoBranchCoords`, keys.length, 1);
    check(`ar ${n}: the lookup is a warning form`, keys[0].startsWith("reports.gpsNoBranchCoords."), keys);
    eq(`ar ${n}: the header is never read`, keys.filter((k) => k.startsWith("reports.col.")), []);
  }
}

console.log("5) the warning text a merchandiser row actually shows");
{
  const ar = tFor("ar");
  const en = tFor("en");
  eq("ar 1",   gpsNoBranchCoordsWarning(1, "ar", ar),   "زيارة واحدة إلى فرع بلا إحداثيات");
  eq("ar 2",   gpsNoBranchCoordsWarning(2, "ar", ar),   "زيارتان إلى فروع بلا إحداثيات");
  eq("ar 3",   gpsNoBranchCoordsWarning(3, "ar", ar),   "3 زيارات إلى فروع بلا إحداثيات");
  eq("ar 11",  gpsNoBranchCoordsWarning(11, "ar", ar),  "11 زيارةً إلى فروع بلا إحداثيات");
  eq("ar 100", gpsNoBranchCoordsWarning(100, "ar", ar), "100 زيارة إلى فروع بلا إحداثيات");
  eq("en 1",   gpsNoBranchCoordsWarning(1, "en", en),   "1 visit to a branch without coordinates");
  eq("en 3",   gpsNoBranchCoordsWarning(3, "en", en),   "3 visits to branches without coordinates");
  eq("en 100", gpsNoBranchCoordsWarning(100, "en", en), "100 visits to branches without coordinates");

  // The old rendering was `${count} ${header}`. Nothing should reproduce it.
  for (const [locale, t] of [["ar", ar], ["en", en]] as const) {
    const bad: number[] = [];
    for (let n = 0; n <= 120; n++) {
      const s = gpsNoBranchCoordsWarning(n, locale, t);
      if (s.includes(t("reports.col.noBranchCoords")) || /\{n\}|\((?:e?s)\)|reports\./.test(s)) bad.push(n);
    }
    eq(`${locale}: 0-120 never reuses the header, a token, a raw key or (s)`, bad, []);
  }
}

console.log("6) the page wires both helpers and no longer touches the header");
{
  const page = readFileSync(join(process.cwd(), "src/app/(dashboard)/reports/page.tsx"), "utf8");
  const lib  = readFileSync(join(process.cwd(), "src/lib/gps-report.ts"), "utf8");

  eq("the page never reads reports.col.noBranchCoords itself", page.split("reports.col.noBranchCoords").length - 1, 0);
  check("the export goes through gpsExportRow", page.includes("sorted.map((r) => gpsExportRow(r, t))"));
  check("the cell goes through gpsNoBranchCoordsWarning",
    page.includes("gpsNoBranchCoordsWarning(r.no_branch_coords, locale, t)"));
  check("the old count-then-header rendering is gone", !/\{r\.no_branch_coords\}\s*\{t\(/.test(page));
  eq("the header key is read exactly once, by the export builder",
    lib.split('t("reports.col.noBranchCoords")').length - 1, 1);
}
