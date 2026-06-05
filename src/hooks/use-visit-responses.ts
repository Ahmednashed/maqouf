"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  fetchVisitResponses,
  saveVisitResponses,
  type VisitTemplateResponse,
  type ResponseUpsertItem,
} from "@/services/visit-responses";
import { useTranslation } from "@/hooks/use-translation";

// ─── Query key ────────────────────────────────────────────────────────────────

export const VISIT_RESPONSES_KEY = (visitId: string) =>
  ["visit-responses", visitId] as const;

// ─── Read ─────────────────────────────────────────────────────────────────────

export function useVisitResponses(visitId: string) {
  return useQuery<VisitTemplateResponse[]>({
    queryKey: VISIT_RESPONSES_KEY(visitId),
    queryFn:  () => fetchVisitResponses(visitId),
    enabled:  Boolean(visitId),
    staleTime: 0,   // always fresh during active audits
  });
}

// ─── Save (upsert) ────────────────────────────────────────────────────────────

export function useSaveVisitResponses(visitId: string) {
  const qc    = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: ({
      templateId,
      items,
    }: {
      templateId: string;
      items: ResponseUpsertItem[];
    }) => saveVisitResponses(visitId, templateId, items),

    onSuccess: () => {
      toast.success(t("visits.responsesSaved"));
    },
    onError: (err: Error) => {
      toast.error(err.message || t("visits.errorSave"));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: VISIT_RESPONSES_KEY(visitId) });
    },
  });
}
