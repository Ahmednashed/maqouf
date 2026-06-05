"use client";

import { useQuery } from "@tanstack/react-query";
import {
  fetchDashboard,
  fetchTrendData,
  fetchActivityFeed,
  type DashboardData,
  type TrendPoint,
  type ActivityVisit,
} from "@/services/dashboard";

// ─── Key factories ─────────────────────────────────────────────────────────────

export const DASHBOARD_KEY  = (date: string)  => ["dashboard",  date]    as const;
export const TREND_KEY      = (days: number)   => ["trend",      days]    as const;
export const ACTIVITY_KEY   =                     ["activity_feed"]        as const;

// ─── Hooks ────────────────────────────────────────────────────────────────────

/** Full dashboard KPIs + lists for the given calendar date. */
export function useDashboard(date: string) {
  return useQuery<DashboardData>({
    queryKey: DASHBOARD_KEY(date),
    queryFn:  () => fetchDashboard(date),
    staleTime: 60_000,   // 1 minute — dashboards should feel live
    enabled:   Boolean(date),
  });
}

/**
 * Daily visit trend for the last `days` calendar days.
 * Default: 30 days.  Suitable for up to ~90 days without pagination.
 */
export function useTrendData(days: number = 30) {
  return useQuery<TrendPoint[]>({
    queryKey: TREND_KEY(days),
    queryFn:  () => fetchTrendData(days),
    staleTime: 5 * 60_000,   // 5 minutes — trend doesn't change by the second
  });
}

/**
 * Live activity feed: last 15 completed visits (all time, company-scoped via RLS).
 * Refreshes every 2 minutes so the feed feels alive.
 */
export function useActivityFeed() {
  return useQuery<ActivityVisit[]>({
    queryKey: ACTIVITY_KEY,
    queryFn:  () => fetchActivityFeed(),
    staleTime: 2 * 60_000,
  });
}
