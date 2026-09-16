import type { TranslationFn } from "@/hooks/use-translation";
import type { TranslationKey } from "@/lib/i18n/translations";
import type { GpsReportRow } from "@/services/reports";
import { pluralKey } from "@/lib/i18n/plural";

/**
 * One GPS-compliance row as it goes into the Excel export.
 *
 * The workbook builder derives its columns from this object's key order, and
 * each key is a translated header, so the order below IS the column order and
 * the header strings must stay distinct from one another — two equal headers
 * would silently collapse into one column.
 *
 * `reports.col.noBranchCoords` is a column heading only. It carries no count;
 * the on-screen sentence that does lives under reports.gpsNoBranchCoords.
 */
export function gpsExportRow(r: GpsReportRow, t: TranslationFn): Record<string, string | number> {
  return {
    [t("reports.col.merch")]:          r.full_name,
    [t("reports.col.totalStarted")]:   r.total_started,
    [t("reports.col.gpsVerified")]:    r.gps_verified,
    [t("reports.col.gpsOutside")]:     r.gps_outside,
    [t("reports.col.gpsNotRecorded")]: r.gps_not_recorded,
    [t("reports.col.noBranchCoords")]: r.no_branch_coords,
    // Empty, not 0%: a rate of zero would assert every check failed.
    [t("reports.col.gpsRate")]:        r.verification_rate === null ? "" : `${r.verification_rate}%`,
    [t("reports.col.avgDistance")]:    r.avg_distance ?? "",
  };
}

/**
 * "N visits to branches without coordinates", agreeing with N.
 *
 * `count` is started visits whose branch has no coordinates (tallyGps). The
 * report only shows this when it is above zero; the zero form exists so every
 * plural category resolves.
 */
export function gpsNoBranchCoordsWarning(count: number, locale: string, t: TranslationFn): string {
  return t(pluralKey("reports.gpsNoBranchCoords", count, locale) as TranslationKey, { n: count });
}
