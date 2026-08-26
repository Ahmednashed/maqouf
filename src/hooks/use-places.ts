"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  fetchPlaces,
  fetchPlaceOperations,
  createPlace,
  updatePlace,
  deletePlace,
  type PlaceInsert,
  type PlaceUpdate,
  type PlaceWithChain,
  type PlaceOps,
} from "@/services/places";
import { useTranslation } from "@/hooks/use-translation";
import { CHAINS_QUERY_KEY } from "@/hooks/use-chains";

// ─── Query key ────────────────────────────────────────────────────────────────
export const PLACES_QUERY_KEY = ["places"] as const;
export const PLACE_OPS_QUERY_KEY = ["places", "operations"] as const;

// ─── Read ─────────────────────────────────────────────────────────────────────

export function usePlaces() {
  return useQuery<PlaceWithChain[]>({
    queryKey: PLACES_QUERY_KEY,
    queryFn:  fetchPlaces,
  });
}

/**
 * Per-branch operational roll-up (last visit, assortment size).
 *
 * Kept as its own query so the branch table paints immediately from the much
 * cheaper places list and fills the operational columns in when they arrive —
 * a slow roll-up must never hold up the register itself.
 */
export function usePlaceOperations() {
  return useQuery<Record<string, PlaceOps>>({
    queryKey: PLACE_OPS_QUERY_KEY,
    queryFn:  fetchPlaceOperations,
  });
}

// ─── Create ───────────────────────────────────────────────────────────────────

export function useCreatePlace() {
  const qc    = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (payload: PlaceInsert) => createPlace(payload),

    onMutate: async (newPlace) => {
      await qc.cancelQueries({ queryKey: PLACES_QUERY_KEY });
      const previous = qc.getQueryData<PlaceWithChain[]>(PLACES_QUERY_KEY);

      // Optimistic row — faded until server confirms.
      qc.setQueryData<PlaceWithChain[]>(PLACES_QUERY_KEY, (old = []) => [
        {
          id:         "__optimistic__",
          company_id: "",
          chain:      undefined,
          is_active:  newPlace.is_active ?? true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...newPlace,
          code: newPlace.code.toUpperCase(),
          // PlaceInsert allows null for lat/lng (DB write); Place does not — normalize.
          lat:  newPlace.lat ?? undefined,
          lng:  newPlace.lng ?? undefined,
        } as PlaceWithChain,
        ...old,
      ]);

      return { previous };
    },

    onError: (_err, _vars, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(PLACES_QUERY_KEY, ctx.previous);
      }
      toast.error(t("places.errorCreate"));
    },

    onSuccess: () => {
      toast.success(t("places.createdOk"));
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: PLACES_QUERY_KEY });
      // Keep chain places_count in sync after adding a branch.
      qc.invalidateQueries({ queryKey: CHAINS_QUERY_KEY });
    },
  });
}

// ─── Update ───────────────────────────────────────────────────────────────────

export function useUpdatePlace() {
  const qc    = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: PlaceUpdate }) =>
      updatePlace(id, payload),

    onMutate: async ({ id, payload }) => {
      await qc.cancelQueries({ queryKey: PLACES_QUERY_KEY });
      const previous = qc.getQueryData<PlaceWithChain[]>(PLACES_QUERY_KEY);

      qc.setQueryData<PlaceWithChain[]>(PLACES_QUERY_KEY, (old = []) =>
        old.map((p) =>
          p.id !== id
            ? p
            : {
                ...p,
                ...payload,
                // PlaceUpdate allows null for lat/lng (DB write); Place does not — normalize.
                lat: payload.lat !== undefined ? (payload.lat ?? undefined) : p.lat,
                lng: payload.lng !== undefined ? (payload.lng ?? undefined) : p.lng,
              }
        )
      );

      return { previous };
    },

    onError: (_err, _vars, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(PLACES_QUERY_KEY, ctx.previous);
      }
      toast.error(t("places.errorUpdate"));
    },

    onSuccess: () => {
      toast.success(t("places.updatedOk"));
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: PLACES_QUERY_KEY });
      qc.invalidateQueries({ queryKey: CHAINS_QUERY_KEY });
    },
  });
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export function useDeletePlace() {
  const qc    = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (id: string) => deletePlace(id),

    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: PLACES_QUERY_KEY });
      const previous = qc.getQueryData<PlaceWithChain[]>(PLACES_QUERY_KEY);

      qc.setQueryData<PlaceWithChain[]>(PLACES_QUERY_KEY, (old = []) =>
        old.filter((p) => p.id !== id)
      );

      return { previous };
    },

    onError: (_err, _vars, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(PLACES_QUERY_KEY, ctx.previous);
      }
      toast.error(t("places.errorDelete"));
    },

    onSuccess: () => {
      toast.success(t("places.deletedOk"));
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: PLACES_QUERY_KEY });
      // places_count on chains changes whenever a branch is deleted.
      qc.invalidateQueries({ queryKey: CHAINS_QUERY_KEY });
    },
  });
}
