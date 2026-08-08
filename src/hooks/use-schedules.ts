"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  fetchSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  type ScheduleInsert,
  type ScheduleUpdate,
  type ScheduleWithDetails,
} from "@/services/schedules";
import { useTranslation } from "@/hooks/use-translation";
import { reconcileSchedule } from "@/services/schedule-reconcile";

// ─── Query key ────────────────────────────────────────────────────────────────
export const SCHEDULES_QUERY_KEY = ["schedules"] as const;

/** Root of the visits key space — reconciliation can change any visit list. */
const VISITS_QUERY_KEY_ROOT = ["visits"] as const;

// ─── Read ─────────────────────────────────────────────────────────────────────

export function useSchedules() {
  return useQuery<ScheduleWithDetails[]>({
    queryKey: SCHEDULES_QUERY_KEY,
    queryFn:  fetchSchedules,
  });
}

// ─── Create ───────────────────────────────────────────────────────────────────

export function useCreateSchedule() {
  const qc    = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (payload: ScheduleInsert) => createSchedule(payload),

    onMutate: async (payload) => {
      await qc.cancelQueries({ queryKey: SCHEDULES_QUERY_KEY });
      const previous = qc.getQueryData<ScheduleWithDetails[]>(SCHEDULES_QUERY_KEY);

      // Lightweight optimistic row — minimal shape so list renders instantly.
      qc.setQueryData<ScheduleWithDetails[]>(SCHEDULES_QUERY_KEY, (old = []) => [
        ...old,
        {
          id:          "__optimistic__",
          company_id:  "",
          is_active:   payload.is_active ?? true,
          created_at:  new Date().toISOString(),
          merch:       { id: payload.merch_id, user: { id: "", full_name: "…", avatar_url: undefined } } as ScheduleWithDetails["merch"],
          place:       { id: payload.place_id, branch_ar: "…", branch_en: "…", code: "" },
          ...payload,
        } as ScheduleWithDetails,
      ]);

      return { previous };
    },

    onError: (_err, _vars, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(SCHEDULES_QUERY_KEY, ctx.previous);
      }
      toast.error(t("schedule.errorCreate"));
    },

    onSuccess: () => toast.success(t("schedule.createdOk")),

    onSettled: () => {
      qc.invalidateQueries({ queryKey: SCHEDULES_QUERY_KEY });
    },
  });
}

// ─── Update ───────────────────────────────────────────────────────────────────

export function useUpdateSchedule() {
  const qc    = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ScheduleUpdate }) =>
      updateSchedule(id, payload),

    onMutate: async ({ id, payload }) => {
      await qc.cancelQueries({ queryKey: SCHEDULES_QUERY_KEY });
      const previous = qc.getQueryData<ScheduleWithDetails[]>(SCHEDULES_QUERY_KEY);

      qc.setQueryData<ScheduleWithDetails[]>(SCHEDULES_QUERY_KEY, (old = []) =>
        old.map((s) => (s.id === id ? { ...s, ...payload } : s))
      );

      return { previous };
    },

    onError: (_err, _vars, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(SCHEDULES_QUERY_KEY, ctx.previous);
      }
      toast.error(t("schedule.errorUpdate"));
    },

    onSuccess: async (_data, { id }) => {
      toast.success(t("schedule.updatedOk"));

      // Reconcile this schedule's future generated visits immediately, so the
      // manager sees the corrected plan now instead of after the daily run.
      //
      // Deliberately NOT part of the update mutation: the schedule edit has
      // already committed and must not be rolled back if reconciliation fails
      // (there is no cross-request transaction to roll back into). The call is
      // idempotent, so a failure is safely retryable — by editing again, by
      // the daily generator, or by an admin re-running it.
      const outcome = await reconcileSchedule(id);

      if (!outcome.ok) {
        toast.warning(t("schedule.reconcileWarning"));
        return;
      }
      // Only surface the toast when something actually changed.
      if (outcome.changed) {
        toast.success(t("schedule.reconciledOk"));
        qc.invalidateQueries({ queryKey: VISITS_QUERY_KEY_ROOT });
      }
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: SCHEDULES_QUERY_KEY });
    },
  });
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export function useDeleteSchedule() {
  const qc    = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (id: string) => deleteSchedule(id),

    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: SCHEDULES_QUERY_KEY });
      const previous = qc.getQueryData<ScheduleWithDetails[]>(SCHEDULES_QUERY_KEY);

      qc.setQueryData<ScheduleWithDetails[]>(SCHEDULES_QUERY_KEY, (old = []) =>
        old.filter((s) => s.id !== id)
      );

      return { previous };
    },

    onError: (_err, _vars, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(SCHEDULES_QUERY_KEY, ctx.previous);
      }
      toast.error(t("schedule.errorDelete"));
    },

    onSuccess: () => toast.success(t("schedule.deletedOk")),

    onSettled: () => {
      qc.invalidateQueries({ queryKey: SCHEDULES_QUERY_KEY });
    },
  });
}
