"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  fetchActivityLogs,
  type ActivityLogFilters,
} from "@/services/activity-logs";
import type { ActivityLog } from "@/types";

// ─── Query keys ───────────────────────────────────────────────────────────────

export const ACTIVITY_LOGS_KEY = (filters: ActivityLogFilters = {}) =>
  ["activity-logs", filters] as const;

const PAGE_SIZE = 20;

// ─── Infinite feed (dashboard) ────────────────────────────────────────────────

/**
 * Paginated activity feed, newest first. Keyset pagination: each page's
 * cursor is the created_at of its last row.
 */
export function useActivityLogs(filters: Omit<ActivityLogFilters, "before"> = {}) {
  return useInfiniteQuery<ActivityLog[]>({
    queryKey: ACTIVITY_LOGS_KEY(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      fetchActivityLogs({
        ...filters,
        limit:  PAGE_SIZE,
        before: pageParam as string | undefined,
      }),
    getNextPageParam: (lastPage) =>
      lastPage.length === PAGE_SIZE
        ? lastPage[lastPage.length - 1].created_at
        : undefined,
    staleTime: 60_000,   // feed feels live without hammering the DB
  });
}

// ─── Per-entity history (visit detail, user timeline) ─────────────────────────

/**
 * All recorded events for one entity, newest first (single page of 50 —
 * more than enough for a visit's lifecycle or one member's recent actions).
 */
export function useEntityActivity(
  entityType: string,
  entityId:   string | undefined
) {
  return useQuery<ActivityLog[]>({
    queryKey: ["entity-activity", entityType, entityId],
    queryFn:  () => fetchActivityLogs({ entityType, entityId, limit: 50 }),
    enabled:  Boolean(entityId),
    staleTime: 60_000,
  });
}

/**
 * Everything one member DID (actor-scoped), newest first.
 * Used by the user activity timeline on the users page.
 */
export function useActorActivity(actorId: string | undefined) {
  return useQuery<ActivityLog[]>({
    queryKey: ["actor-activity", actorId],
    queryFn:  () => fetchActivityLogs({ actorId, limit: 50 }),
    enabled:  Boolean(actorId),
    staleTime: 60_000,
  });
}
