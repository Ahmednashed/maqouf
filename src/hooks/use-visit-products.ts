"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  fetchVisitProducts,
  saveVisitProducts,
  type VisitProductWithDetails,
  type VisitProductSave,
} from "@/services/visit-products";
import { useTranslation } from "@/hooks/use-translation";

// ─── Query key factory ────────────────────────────────────────────────────────

export const VISIT_PRODUCTS_KEY = (visitId: string) =>
  ["visit-products", visitId] as const;

// ─── Read ─────────────────────────────────────────────────────────────────────

export function useVisitProducts(visitId: string, placeId: string) {
  return useQuery<VisitProductWithDetails[]>({
    queryKey: VISIT_PRODUCTS_KEY(visitId),
    queryFn:  () => fetchVisitProducts(visitId, placeId),
    enabled:  Boolean(visitId) && Boolean(placeId),
    // Don't stale-while-revalidate during active audits — always fresh
    staleTime: 0,
  });
}

// ─── Save ─────────────────────────────────────────────────────────────────────

/**
 * Upsert audit results for all products in a visit.
 * Not optimistic — the save is fast (single round-trip) and the source of
 * truth matters too much to risk showing stale totals on completion.
 */
export function useSaveVisitProducts(visitId: string) {
  const qc    = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (items: VisitProductSave[]) => saveVisitProducts(visitId, items),

    onSuccess: () => {
      toast.success(t("visits.savedOk"));
      qc.invalidateQueries({ queryKey: VISIT_PRODUCTS_KEY(visitId) });
    },
    onError: (err: Error) => {
      toast.error(err.message || t("visits.errorSave"));
    },
  });
}
