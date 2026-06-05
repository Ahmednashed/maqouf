"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  fetchPlaceProducts,
  assignPlaceProduct,
  updatePlaceProduct,
  removePlaceProduct,
  type PlaceProductAssign,
  type PlaceProductUpdate,
  type PlaceProductWithProduct,
} from "@/services/place-products";
import { useTranslation } from "@/hooks/use-translation";

// ─── Query key factory ────────────────────────────────────────────────────────
export const placeProductsKey = (placeId: string) =>
  ["place-products", placeId] as const;

// ─── Read ─────────────────────────────────────────────────────────────────────

export function usePlaceProducts(placeId: string | null) {
  return useQuery<PlaceProductWithProduct[]>({
    queryKey: placeProductsKey(placeId ?? ""),
    queryFn:  () => fetchPlaceProducts(placeId!),
    enabled:  !!placeId,
  });
}

// ─── Assign (Create) ──────────────────────────────────────────────────────────

export function useAssignPlaceProduct() {
  const qc    = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (payload: PlaceProductAssign) => assignPlaceProduct(payload),

    onMutate: async (payload) => {
      const key = placeProductsKey(payload.place_id);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<PlaceProductWithProduct[]>(key);

      // Optimistic insert — will be replaced by real data on settled.
      qc.setQueryData<PlaceProductWithProduct[]>(key, (old = []) => [
        ...old,
        {
          place_id:         payload.place_id,
          product_id:       payload.product_id,
          is_mandatory:     payload.is_mandatory  ?? false,
          min_stock:        payload.min_stock      ?? 0,
          display_priority: payload.display_priority ?? 0,
          is_active:        payload.is_active      ?? true,
          created_at:       new Date().toISOString(),
          product:          { id: payload.product_id } as PlaceProductWithProduct["product"],
        },
      ]);

      return { previous, key };
    },

    onError: (_err, vars, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(ctx.key, ctx.previous);
      }
      toast.error(t("placeProducts.errorAssign"));
    },

    onSuccess: () => {
      toast.success(t("placeProducts.assignedOk"));
    },

    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey: placeProductsKey(vars.place_id) });
    },
  });
}

// ─── Update ───────────────────────────────────────────────────────────────────

export function useUpdatePlaceProduct() {
  const qc    = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: ({
      placeId,
      productId,
      payload,
    }: {
      placeId:   string;
      productId: string;
      payload:   PlaceProductUpdate;
    }) => updatePlaceProduct(placeId, productId, payload),

    onMutate: async ({ placeId, productId, payload }) => {
      const key = placeProductsKey(placeId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<PlaceProductWithProduct[]>(key);

      qc.setQueryData<PlaceProductWithProduct[]>(key, (old = []) =>
        old.map((pp) =>
          pp.product_id === productId ? { ...pp, ...payload } : pp
        )
      );

      return { previous, key };
    },

    onError: (_err, _vars, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(ctx.key, ctx.previous);
      }
      toast.error(t("placeProducts.errorUpdate"));
    },

    onSuccess: () => {
      toast.success(t("placeProducts.updatedOk"));
    },

    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey: placeProductsKey(vars.placeId) });
    },
  });
}

// ─── Remove (Delete) ──────────────────────────────────────────────────────────

export function useRemovePlaceProduct() {
  const qc    = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: ({ placeId, productId }: { placeId: string; productId: string }) =>
      removePlaceProduct(placeId, productId),

    onMutate: async ({ placeId, productId }) => {
      const key = placeProductsKey(placeId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<PlaceProductWithProduct[]>(key);

      qc.setQueryData<PlaceProductWithProduct[]>(key, (old = []) =>
        old.filter((pp) => pp.product_id !== productId)
      );

      return { previous, key };
    },

    onError: (_err, _vars, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(ctx.key, ctx.previous);
      }
      toast.error(t("placeProducts.errorRemove"));
    },

    onSuccess: () => {
      toast.success(t("placeProducts.removedOk"));
    },

    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey: placeProductsKey(vars.placeId) });
    },
  });
}
