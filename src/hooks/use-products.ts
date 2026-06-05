"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  fetchProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  type ProductInsert,
  type ProductUpdate,
} from "@/services/products";
import { useTranslation } from "@/hooks/use-translation";
import type { Product } from "@/types";

// ─── Query key ────────────────────────────────────────────────────────────────
export const PRODUCTS_QUERY_KEY = ["products"] as const;

// ─── Read ─────────────────────────────────────────────────────────────────────

export function useProducts() {
  return useQuery<Product[]>({
    queryKey: PRODUCTS_QUERY_KEY,
    queryFn:  fetchProducts,
  });
}

// ─── Create ───────────────────────────────────────────────────────────────────

export function useCreateProduct() {
  const qc    = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (payload: ProductInsert) => createProduct(payload),

    onMutate: async (newProduct) => {
      await qc.cancelQueries({ queryKey: PRODUCTS_QUERY_KEY });
      const previous = qc.getQueryData<Product[]>(PRODUCTS_QUERY_KEY);

      // Optimistic row — faded until server confirms.
      qc.setQueryData<Product[]>(PRODUCTS_QUERY_KEY, (old = []) => [
        {
          id:         "__optimistic__",
          company_id: "",
          stock:      0,
          is_active:  newProduct.is_active ?? true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...newProduct,
          sku: newProduct.sku.toUpperCase(),
        } as Product,
        ...old,
      ]);

      return { previous };
    },

    onError: (_err, _vars, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(PRODUCTS_QUERY_KEY, ctx.previous);
      }
      toast.error(t("products.errorCreate"));
    },

    onSuccess: () => {
      toast.success(t("products.createdOk"));
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY });
    },
  });
}

// ─── Update ───────────────────────────────────────────────────────────────────

export function useUpdateProduct() {
  const qc    = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ProductUpdate }) =>
      updateProduct(id, payload),

    onMutate: async ({ id, payload }) => {
      await qc.cancelQueries({ queryKey: PRODUCTS_QUERY_KEY });
      const previous = qc.getQueryData<Product[]>(PRODUCTS_QUERY_KEY);

      qc.setQueryData<Product[]>(PRODUCTS_QUERY_KEY, (old = []) =>
        old.map((p) =>
          p.id !== id
            ? p
            : {
                ...p,
                ...payload,
                // ProductUpdate allows null for cost/price (DB write); Product does not — normalize.
                cost:  payload.cost  !== undefined ? (payload.cost  ?? undefined) : p.cost,
                price: payload.price !== undefined ? (payload.price ?? undefined) : p.price,
              }
        )
      );

      return { previous };
    },

    onError: (_err, _vars, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(PRODUCTS_QUERY_KEY, ctx.previous);
      }
      toast.error(t("products.errorUpdate"));
    },

    onSuccess: () => {
      toast.success(t("products.updatedOk"));
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY });
    },
  });
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export function useDeleteProduct() {
  const qc    = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (id: string) => deleteProduct(id),

    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: PRODUCTS_QUERY_KEY });
      const previous = qc.getQueryData<Product[]>(PRODUCTS_QUERY_KEY);

      qc.setQueryData<Product[]>(PRODUCTS_QUERY_KEY, (old = []) =>
        old.filter((p) => p.id !== id)
      );

      return { previous };
    },

    onError: (_err, _vars, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(PRODUCTS_QUERY_KEY, ctx.previous);
      }
      toast.error(t("products.errorDelete"));
    },

    onSuccess: () => {
      toast.success(t("products.deletedOk"));
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY });
    },
  });
}
