"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  fetchChains,
  createChain,
  updateChain,
  deleteChain,
  type ChainInsert,
  type ChainUpdate,
  type ChainWithCount,
} from "@/services/chains";
import { useTranslation } from "@/hooks/use-translation";

// ─── Query key ────────────────────────────────────────────────────────────────
// Exported so other hooks (e.g. places) can invalidate chains when needed.
export const CHAINS_QUERY_KEY = ["chains"] as const;

// ─── Read ─────────────────────────────────────────────────────────────────────

export function useChains() {
  return useQuery<ChainWithCount[]>({
    queryKey: CHAINS_QUERY_KEY,
    queryFn:  fetchChains,
  });
}

// ─── Create ───────────────────────────────────────────────────────────────────

export function useCreateChain() {
  const qc        = useQueryClient();
  const { t }     = useTranslation();

  return useMutation({
    mutationFn: (payload: ChainInsert) => createChain(payload),

    // Optimistic update: append a temporary placeholder before the server responds.
    onMutate: async (newChain) => {
      await qc.cancelQueries({ queryKey: CHAINS_QUERY_KEY });
      const previous = qc.getQueryData<ChainWithCount[]>(CHAINS_QUERY_KEY);

      qc.setQueryData<ChainWithCount[]>(CHAINS_QUERY_KEY, (old = []) => [
        {
          id:           "__optimistic__",
          company_id:   "",
          ...newChain,
          color:        newChain.color ?? "#111827",
          is_active:    newChain.is_active ?? true,
          logo_url:     undefined,
          places_count: 0,
          created_at:   new Date().toISOString(),
          updated_at:   new Date().toISOString(),
        },
        ...old,
      ]);

      return { previous };
    },

    onError: (_err, _vars, ctx) => {
      // Roll back to the snapshot taken before the optimistic update.
      if (ctx?.previous !== undefined) {
        qc.setQueryData(CHAINS_QUERY_KEY, ctx.previous);
      }
      toast.error(t("chains.errorCreate"));
    },

    onSuccess: () => {
      toast.success(t("chains.createdOk"));
    },

    onSettled: () => {
      // Always refetch to get the real server data.
      qc.invalidateQueries({ queryKey: CHAINS_QUERY_KEY });
    },
  });
}

// ─── Update ───────────────────────────────────────────────────────────────────

export function useUpdateChain() {
  const qc    = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ChainUpdate }) =>
      updateChain(id, payload),

    onMutate: async ({ id, payload }) => {
      await qc.cancelQueries({ queryKey: CHAINS_QUERY_KEY });
      const previous = qc.getQueryData<ChainWithCount[]>(CHAINS_QUERY_KEY);

      qc.setQueryData<ChainWithCount[]>(CHAINS_QUERY_KEY, (old = []) =>
        old.map((chain) =>
          chain.id === id ? { ...chain, ...payload } : chain
        )
      );

      return { previous };
    },

    onError: (_err, _vars, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(CHAINS_QUERY_KEY, ctx.previous);
      }
      toast.error(t("chains.errorUpdate"));
    },

    onSuccess: () => {
      toast.success(t("chains.updatedOk"));
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: CHAINS_QUERY_KEY });
    },
  });
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export function useDeleteChain() {
  const qc    = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (id: string) => deleteChain(id),

    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: CHAINS_QUERY_KEY });
      const previous = qc.getQueryData<ChainWithCount[]>(CHAINS_QUERY_KEY);

      // Remove immediately from the cache for instant UI feedback.
      qc.setQueryData<ChainWithCount[]>(CHAINS_QUERY_KEY, (old = []) =>
        old.filter((chain) => chain.id !== id)
      );

      return { previous };
    },

    onError: (_err, _vars, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(CHAINS_QUERY_KEY, ctx.previous);
      }
      toast.error(t("chains.errorDelete"));
    },

    onSuccess: () => {
      toast.success(t("chains.deletedOk"));
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: CHAINS_QUERY_KEY });
    },
  });
}
