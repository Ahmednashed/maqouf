"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  fetchTemplates,
  fetchTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  createField,
  updateField,
  deleteField,
  reorderFields,
  type TemplateInsert,
  type TemplateUpdate,
  type FieldInsert,
  type FieldUpdate,
} from "@/services/templates";
import type { TemplateListItem, TemplateWithFields, TemplateFieldFull } from "@/types";
import { useTranslation } from "@/hooks/use-translation";

// ─── Query key factories ──────────────────────────────────────────────────────

export const TEMPLATES_QUERY_KEY   = ["templates"] as const;
export const TEMPLATE_QUERY_KEY    = (id: string) => ["template", id] as const;

// ─── List ─────────────────────────────────────────────────────────────────────

export function useTemplates() {
  return useQuery<TemplateListItem[]>({
    queryKey: TEMPLATES_QUERY_KEY,
    queryFn:  fetchTemplates,
  });
}

// ─── Single (builder) ─────────────────────────────────────────────────────────

export function useTemplate(id: string) {
  return useQuery<TemplateWithFields>({
    queryKey: TEMPLATE_QUERY_KEY(id),
    queryFn:  () => fetchTemplate(id),
    enabled:  Boolean(id),
  });
}

// ─── Create template ──────────────────────────────────────────────────────────

export function useCreateTemplate() {
  const qc    = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (payload: TemplateInsert) => createTemplate(payload),

    onSuccess: () => {
      toast.success(t("templates.createdOk"));
    },
    onError: (err: Error) => {
      toast.error(err.message || t("templates.errorCreate"));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: TEMPLATES_QUERY_KEY });
    },
  });
}

// ─── Update template ──────────────────────────────────────────────────────────

export function useUpdateTemplate() {
  const qc    = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: TemplateUpdate }) =>
      updateTemplate(id, payload),

    // Optimistic: update list + single cache
    onMutate: async ({ id, payload }) => {
      await qc.cancelQueries({ queryKey: TEMPLATES_QUERY_KEY });
      await qc.cancelQueries({ queryKey: TEMPLATE_QUERY_KEY(id) });

      const prevList   = qc.getQueryData<TemplateListItem[]>(TEMPLATES_QUERY_KEY);
      const prevSingle = qc.getQueryData<TemplateWithFields>(TEMPLATE_QUERY_KEY(id));

      qc.setQueryData<TemplateListItem[]>(TEMPLATES_QUERY_KEY, (old = []) =>
        old.map((t) => (t.id === id ? { ...t, ...payload } : t))
      );
      if (prevSingle) {
        qc.setQueryData<TemplateWithFields>(TEMPLATE_QUERY_KEY(id), {
          ...prevSingle,
          ...payload,
        });
      }

      return { prevList, prevSingle };
    },

    onError: (_err, { id }, ctx) => {
      if (ctx?.prevList)   qc.setQueryData(TEMPLATES_QUERY_KEY, ctx.prevList);
      if (ctx?.prevSingle) qc.setQueryData(TEMPLATE_QUERY_KEY(id), ctx.prevSingle);
      toast.error(t("templates.errorUpdate"));
    },

    onSuccess: () => toast.success(t("templates.updatedOk")),

    onSettled: (_, __, { id }) => {
      qc.invalidateQueries({ queryKey: TEMPLATES_QUERY_KEY });
      qc.invalidateQueries({ queryKey: TEMPLATE_QUERY_KEY(id) });
    },
  });
}

// ─── Delete template ──────────────────────────────────────────────────────────

export function useDeleteTemplate() {
  const qc    = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (id: string) => deleteTemplate(id),

    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: TEMPLATES_QUERY_KEY });
      const prev = qc.getQueryData<TemplateListItem[]>(TEMPLATES_QUERY_KEY);
      qc.setQueryData<TemplateListItem[]>(TEMPLATES_QUERY_KEY, (old = []) =>
        old.filter((t) => t.id !== id)
      );
      return { prev };
    },

    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(TEMPLATES_QUERY_KEY, ctx.prev);
      toast.error(t("templates.errorDelete"));
    },

    onSuccess: () => toast.success(t("templates.deletedOk")),

    onSettled: () => {
      qc.invalidateQueries({ queryKey: TEMPLATES_QUERY_KEY });
    },
  });
}

// ─── Create field ─────────────────────────────────────────────────────────────

export function useCreateField(templateId: string) {
  const qc    = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (payload: FieldInsert) => createField(templateId, payload),

    onSuccess: (newField) => {
      // Append to the single-template cache immediately
      qc.setQueryData<TemplateWithFields>(TEMPLATE_QUERY_KEY(templateId), (old) => {
        if (!old) return old;
        return { ...old, fields: [...old.fields, newField] };
      });
      toast.success(t("templates.fieldCreatedOk"));
    },

    onError: (err: Error) => {
      toast.error(err.message || t("templates.errorField"));
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: TEMPLATE_QUERY_KEY(templateId) });
    },
  });
}

// ─── Update field ─────────────────────────────────────────────────────────────

export function useUpdateField(templateId: string) {
  const qc    = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: FieldUpdate }) =>
      updateField(id, payload),

    onMutate: async ({ id, payload }) => {
      await qc.cancelQueries({ queryKey: TEMPLATE_QUERY_KEY(templateId) });
      const prev = qc.getQueryData<TemplateWithFields>(TEMPLATE_QUERY_KEY(templateId));

      qc.setQueryData<TemplateWithFields>(TEMPLATE_QUERY_KEY(templateId), (old) => {
        if (!old) return old;
        return {
          ...old,
          fields: old.fields.map((f) =>
            f.id === id ? { ...f, ...payload } : f
          ),
        };
      });

      return { prev };
    },

    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(TEMPLATE_QUERY_KEY(templateId), ctx.prev);
      toast.error(t("templates.errorField"));
    },

    onSuccess: () => toast.success(t("templates.fieldUpdatedOk")),

    onSettled: () => {
      qc.invalidateQueries({ queryKey: TEMPLATE_QUERY_KEY(templateId) });
    },
  });
}

// ─── Delete field ─────────────────────────────────────────────────────────────

export function useDeleteField(templateId: string) {
  const qc    = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (fieldId: string) => deleteField(fieldId),

    onMutate: async (fieldId) => {
      await qc.cancelQueries({ queryKey: TEMPLATE_QUERY_KEY(templateId) });
      const prev = qc.getQueryData<TemplateWithFields>(TEMPLATE_QUERY_KEY(templateId));

      qc.setQueryData<TemplateWithFields>(TEMPLATE_QUERY_KEY(templateId), (old) => {
        if (!old) return old;
        return { ...old, fields: old.fields.filter((f) => f.id !== fieldId) };
      });

      return { prev };
    },

    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(TEMPLATE_QUERY_KEY(templateId), ctx.prev);
      toast.error(t("templates.errorField"));
    },

    onSuccess: () => toast.success(t("templates.fieldDeletedOk")),

    onSettled: () => {
      qc.invalidateQueries({ queryKey: TEMPLATE_QUERY_KEY(templateId) });
    },
  });
}

// ─── Reorder fields ───────────────────────────────────────────────────────────

export function useReorderFields(templateId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (updates: Array<{ id: string; sort_order: number }>) =>
      reorderFields(updates),

    // Optimistic: reorder in the builder cache immediately — no toast (silent UX)
    onMutate: async (updates) => {
      await qc.cancelQueries({ queryKey: TEMPLATE_QUERY_KEY(templateId) });
      const prev = qc.getQueryData<TemplateWithFields>(TEMPLATE_QUERY_KEY(templateId));

      const orderMap = new Map(updates.map((u) => [u.id, u.sort_order]));

      qc.setQueryData<TemplateWithFields>(TEMPLATE_QUERY_KEY(templateId), (old) => {
        if (!old) return old;
        return {
          ...old,
          fields: [...old.fields]
            .map((f) => ({ ...f, sort_order: orderMap.get(f.id) ?? f.sort_order }))
            .sort((a, b) => a.sort_order - b.sort_order),
        };
      });

      return { prev };
    },

    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(TEMPLATE_QUERY_KEY(templateId), ctx.prev);
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: TEMPLATE_QUERY_KEY(templateId) });
    },
  });
}
