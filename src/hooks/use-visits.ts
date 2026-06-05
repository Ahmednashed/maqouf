"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  fetchVisits,
  fetchVisit,
  createVisit,
  startVisit,
  completeVisit,
  markVisitMissed,
  type VisitWithDetails,
  type VisitFilters,
  type VisitCreatePayload,
} from "@/services/visits";
import { type GpsPosition } from "@/lib/geo";
import { useTranslation } from "@/hooks/use-translation";

// ─── Query key factories ──────────────────────────────────────────────────────

export const VISITS_QUERY_KEY = (filters?: VisitFilters) =>
  filters ? (["visits", filters] as const) : (["visits"] as const);

export const VISIT_QUERY_KEY = (id: string) => ["visit", id] as const;

// ─── List ─────────────────────────────────────────────────────────────────────

export function useVisits(filters: VisitFilters = {}) {
  return useQuery<VisitWithDetails[]>({
    queryKey: VISITS_QUERY_KEY(filters),
    queryFn:  () => fetchVisits(filters),
    staleTime: 30_000,
  });
}

// ─── Single ───────────────────────────────────────────────────────────────────

export function useVisit(id: string) {
  return useQuery<VisitWithDetails>({
    queryKey: VISIT_QUERY_KEY(id),
    queryFn:  () => fetchVisit(id),
    enabled:  Boolean(id),
  });
}

// ─── Create (admin) ───────────────────────────────────────────────────────────

export function useCreateVisit() {
  const qc    = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (payload: VisitCreatePayload) => createVisit(payload),

    onSuccess: () => {
      toast.success(t("visits.createdOk"));
    },
    onError: (err: Error) => {
      toast.error(err.message || t("visits.errorCreate"));
    },
    onSettled: () => {
      // Invalidate ALL visits queries (any filter combination)
      qc.invalidateQueries({ queryKey: ["visits"] });
    },
  });
}

// ─── Start visit ──────────────────────────────────────────────────────────────

/**
 * Payload for starting a visit.
 * position is optional: omit when the branch has no coordinates and the
 * merchandiser chose to start anyway without GPS validation.
 */
export interface StartVisitPayload {
  visitId:   string;
  position?: GpsPosition;
}

export function useStartVisit() {
  const qc    = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: ({ visitId, position }: StartVisitPayload) =>
      startVisit(visitId, position),

    // Optimistic: flip status in every cached visits list immediately.
    onMutate: async ({ visitId }) => {
      await qc.cancelQueries({ queryKey: ["visits"] });
      const snapshots = qc.getQueriesData<VisitWithDetails[]>({ queryKey: ["visits"] });

      qc.setQueriesData<VisitWithDetails[]>({ queryKey: ["visits"] }, (old = []) =>
        old.map((v) => (v.id === visitId ? { ...v, status: "inprogress" as const } : v))
      );

      return { snapshots };
    },

    onError: (err: Error, _vars, ctx) => {
      // Roll back every snapshot.
      ctx?.snapshots?.forEach(([key, data]) => qc.setQueryData(key, data));
      // Surface the service-layer error (e.g. "Too far from branch") as a toast.
      toast.error(err.message || t("visits.errorStart"));
    },

    onSuccess: (data) => {
      // Warm the single-visit cache so the detail page renders instantly.
      qc.setQueryData(VISIT_QUERY_KEY(data.id), data);
      toast.success(t("visits.startedOk"));
    },

    onSettled: (data) => {
      qc.invalidateQueries({ queryKey: ["visits"] });
      if (data) qc.invalidateQueries({ queryKey: VISIT_QUERY_KEY(data.id) });
    },
  });
}

// ─── Complete ─────────────────────────────────────────────────────────────────

export function useCompleteVisit() {
  const qc    = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: ({ id, notes }: { id: string; notes?: string }) =>
      completeVisit(id, notes),

    onSuccess: (data) => {
      qc.setQueryData(VISIT_QUERY_KEY(data.id), data);
      toast.success(t("visits.completedOk"));
    },
    onError: (err: Error) => {
      toast.error(err.message || t("visits.errorComplete"));
    },
    onSettled: (data) => {
      qc.invalidateQueries({ queryKey: ["visits"] });
      if (data) qc.invalidateQueries({ queryKey: VISIT_QUERY_KEY(data.id) });
    },
  });
}

// ─── Mark missed ──────────────────────────────────────────────────────────────

export function useMarkMissed() {
  const qc    = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (id: string) => markVisitMissed(id),

    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["visits"] });
      const snapshots = qc.getQueriesData<VisitWithDetails[]>({ queryKey: ["visits"] });

      qc.setQueriesData<VisitWithDetails[]>({ queryKey: ["visits"] }, (old = []) =>
        old.map((v) => (v.id === id ? { ...v, status: "missed" as const } : v))
      );

      return { snapshots };
    },

    onError: (_err, _id, ctx) => {
      ctx?.snapshots?.forEach(([key, data]) => qc.setQueryData(key, data));
      toast.error(t("visits.errorUpdate"));
    },

    onSuccess: (data) => {
      qc.setQueryData(VISIT_QUERY_KEY(data.id), data);
      toast.success(t("visits.missedOk"));
    },

    onSettled: (data) => {
      qc.invalidateQueries({ queryKey: ["visits"] });
      if (data) qc.invalidateQueries({ queryKey: VISIT_QUERY_KEY(data.id) });
    },
  });
}
