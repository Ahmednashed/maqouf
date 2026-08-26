"use client";

import { useQuery } from "@tanstack/react-query";
import {
  fetchVisitsReport,
  fetchMerchReport,
  fetchBranchReport,
  fetchProductReport,
  fetchGpsReport,
  fetchReportSummary,
  type DateRange,
  type ReportFilters,
  type ReportSummary,
  type VisitReportRow,
  type MerchReportRow,
  type BranchReportRow,
  type ProductReportRow,
  type GpsReportRow,
} from "@/services/reports";

// Re-export so consumers can import from one place
export type {
  DateRange, ReportFilters, ReportSummary,
  VisitReportRow, MerchReportRow, BranchReportRow, ProductReportRow, GpsReportRow,
};

// ─── Query key factories ──────────────────────────────────────────────────────

/**
 * Filters are part of the key, not just the fetch. Leaving them out would serve
 * a cached unfiltered report the moment a filter changed, and — because the
 * Excel export writes whatever is currently on screen — quietly export the
 * wrong rows under a filtered heading.
 *
 * Normalised to "" so that undefined and empty string cannot produce two keys
 * for the same query.
 */
const key = (type: string, range: DateRange, filters?: ReportFilters) =>
  [
    "reports", type, range.from, range.to,
    filters?.merchId ?? "",
    filters?.placeId ?? "",
    filters?.status  ?? "",
  ] as const;

const ready = (range: DateRange) => Boolean(range.from) && Boolean(range.to);

// ─── Hooks ───────────────────────────────────────────────────────────────────

export function useReportSummary(range: DateRange, filters?: ReportFilters, enabled = true) {
  return useQuery<ReportSummary>({
    queryKey: key("summary", range, filters),
    queryFn:  () => fetchReportSummary(range, filters),
    staleTime: 120_000,
    enabled:   enabled && ready(range),
  });
}

export function useVisitsReport(range: DateRange, filters?: ReportFilters, enabled = true) {
  return useQuery<VisitReportRow[]>({
    queryKey: key("visits", range, filters),
    queryFn:  () => fetchVisitsReport(range, filters),
    staleTime: 120_000,
    enabled:   enabled && ready(range),
  });
}

export function useMerchReport(range: DateRange, filters?: ReportFilters, enabled = true) {
  return useQuery<MerchReportRow[]>({
    queryKey: key("merch", range, filters),
    queryFn:  () => fetchMerchReport(range, filters),
    staleTime: 120_000,
    enabled:   enabled && ready(range),
  });
}

export function useBranchReport(range: DateRange, filters?: ReportFilters, enabled = true) {
  return useQuery<BranchReportRow[]>({
    queryKey: key("branch", range, filters),
    queryFn:  () => fetchBranchReport(range, filters),
    staleTime: 120_000,
    enabled:   enabled && ready(range),
  });
}

export function useProductReport(range: DateRange, filters?: ReportFilters, enabled = true) {
  return useQuery<ProductReportRow[]>({
    queryKey: key("product", range, filters),
    queryFn:  () => fetchProductReport(range, filters),
    staleTime: 120_000,
    enabled:   enabled && ready(range),
  });
}

export function useGpsReport(range: DateRange, filters?: ReportFilters, enabled = true) {
  return useQuery<GpsReportRow[]>({
    queryKey: key("gps", range, filters),
    queryFn:  () => fetchGpsReport(range, filters),
    staleTime: 120_000,
    enabled:   enabled && ready(range),
  });
}
