"use client";

import { useQuery } from "@tanstack/react-query";
import {
  fetchVisitsReport,
  fetchMerchReport,
  fetchBranchReport,
  fetchProductReport,
  fetchGpsReport,
  type DateRange,
  type VisitReportRow,
  type MerchReportRow,
  type BranchReportRow,
  type ProductReportRow,
  type GpsReportRow,
} from "@/services/reports";

// Re-export so consumers can import from one place
export type { DateRange, VisitReportRow, MerchReportRow, BranchReportRow, ProductReportRow, GpsReportRow };

// ─── Query key factories ──────────────────────────────────────────────────────

const key = (type: string, range: DateRange) =>
  ["reports", type, range.from, range.to] as const;

// ─── Hooks ───────────────────────────────────────────────────────────────────

export function useVisitsReport(range: DateRange, enabled = true) {
  return useQuery<VisitReportRow[]>({
    queryKey: key("visits", range),
    queryFn:  () => fetchVisitsReport(range),
    staleTime: 120_000,
    enabled:   enabled && Boolean(range.from) && Boolean(range.to),
  });
}

export function useMerchReport(range: DateRange, enabled = true) {
  return useQuery<MerchReportRow[]>({
    queryKey: key("merch", range),
    queryFn:  () => fetchMerchReport(range),
    staleTime: 120_000,
    enabled:   enabled && Boolean(range.from) && Boolean(range.to),
  });
}

export function useBranchReport(range: DateRange, enabled = true) {
  return useQuery<BranchReportRow[]>({
    queryKey: key("branch", range),
    queryFn:  () => fetchBranchReport(range),
    staleTime: 120_000,
    enabled:   enabled && Boolean(range.from) && Boolean(range.to),
  });
}

export function useProductReport(range: DateRange, enabled = true) {
  return useQuery<ProductReportRow[]>({
    queryKey: key("product", range),
    queryFn:  () => fetchProductReport(range),
    staleTime: 120_000,
    enabled:   enabled && Boolean(range.from) && Boolean(range.to),
  });
}

export function useGpsReport(range: DateRange, enabled = true) {
  return useQuery<GpsReportRow[]>({
    queryKey: key("gps", range),
    queryFn:  () => fetchGpsReport(range),
    staleTime: 120_000,
    enabled:   enabled && Boolean(range.from) && Boolean(range.to),
  });
}
