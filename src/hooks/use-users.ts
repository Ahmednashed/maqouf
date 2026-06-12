"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  fetchAllCompanyUsers,
  updateCompanyUser,
  type CompanyUserWithProfile,
  type CompanyUserUpdate,
} from "@/services/company-users";
import {
  inviteCompanyUser,
  type InvitePayload,
  type InviteStatus,
} from "@/services/invitations";
import { uploadUserAvatar } from "@/services/storage";
import { useTranslation } from "@/hooks/use-translation";
import { COMPANY_USERS_QUERY_KEY } from "@/hooks/use-company-users";
import { CURRENT_MEMBER_KEY } from "@/hooks/use-current-member";

// ─── Query key ────────────────────────────────────────────────────────────────
export const USERS_QUERY_KEY = ["users"] as const;

// ─── Read ─────────────────────────────────────────────────────────────────────

/** Fetch all company members (active + inactive) for the management page. */
export function useUsers() {
  return useQuery<CompanyUserWithProfile[]>({
    queryKey: USERS_QUERY_KEY,
    queryFn:  fetchAllCompanyUsers,
  });
}

// ─── Invite (replaces the old manual-create flow) ────────────────────────────

/**
 * Invite a new user by email via the `invite-company-user` Edge Function.
 *
 * Three non-error outcomes (all resolve, never throw):
 *   "invited"        → email sent; toast: inviteSent
 *   "added"          → already registered; added directly; toast: inviteAdded
 *   "already_member" → already in company; toast: alreadyMember
 *
 * Any validation or permission error from the Edge Function is surfaced
 * as a thrown Error and shown via the onError toast.
 */
export function useInviteUser() {
  const qc    = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (payload: InvitePayload) => inviteCompanyUser(payload),

    onSuccess: (result) => {
      const statusToast: Record<InviteStatus, () => void> = {
        invited:        () => toast.success(t("users.inviteSent")),
        added:          () => toast.success(t("users.inviteAdded")),
        already_member: () => toast.info(t("users.alreadyMember")),
      };
      statusToast[result.status]?.();
    },

    onError: (err: Error) => {
      toast.error(err.message || t("users.errorInvite"));
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: USERS_QUERY_KEY });
      // Keep the merchandiser dropdown in the schedules module fresh.
      qc.invalidateQueries({ queryKey: COMPANY_USERS_QUERY_KEY() });
    },
  });
}

// ─── Update ───────────────────────────────────────────────────────────────────

export function useUpdateUser() {
  const qc    = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: CompanyUserUpdate }) =>
      updateCompanyUser(id, payload),

    onMutate: async ({ id, payload }) => {
      await qc.cancelQueries({ queryKey: USERS_QUERY_KEY });
      const previous = qc.getQueryData<CompanyUserWithProfile[]>(USERS_QUERY_KEY);

      qc.setQueryData<CompanyUserWithProfile[]>(USERS_QUERY_KEY, (old = []) =>
        old.map((u) => (u.id === id ? { ...u, ...payload } as CompanyUserWithProfile : u))
      );

      return { previous };
    },

    onError: (_err, _vars, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(USERS_QUERY_KEY, ctx.previous);
      }
      toast.error(t("users.errorUpdate"));
    },

    onSuccess: () => {
      toast.success(t("users.updatedOk"));
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: USERS_QUERY_KEY });
      qc.invalidateQueries({ queryKey: COMPANY_USERS_QUERY_KEY() });
      // Refresh topbar account chip if the user updated their own display_name
      qc.invalidateQueries({ queryKey: CURRENT_MEMBER_KEY });
    },
  });
}

// ─── Upload avatar ────────────────────────────────────────────────────────────

export function useUpdateUserAvatar() {
  const qc    = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      const avatarUrl = await uploadUserAvatar(file, id);
      await updateCompanyUser(id, { avatar_url: avatarUrl });
      return avatarUrl;
    },

    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: USERS_QUERY_KEY });
      return { previous: qc.getQueryData<CompanyUserWithProfile[]>(USERS_QUERY_KEY) };
    },

    onError: (err: Error, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(USERS_QUERY_KEY, ctx.previous);
      toast.error(err.message || t("users.errorUpdate"));
    },

    onSuccess: (avatarUrl, { id }) => {
      qc.setQueryData<CompanyUserWithProfile[]>(USERS_QUERY_KEY, (old = []) =>
        old.map((u) => (u.id === id ? { ...u, avatar_url: avatarUrl } : u))
      );
      toast.success(t("users.avatarUpdated"));
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: USERS_QUERY_KEY });
      qc.invalidateQueries({ queryKey: COMPANY_USERS_QUERY_KEY() });
      // Refresh topbar if the user updated their own avatar
      qc.invalidateQueries({ queryKey: CURRENT_MEMBER_KEY });
    },
  });
}

// ─── Toggle status (activate / deactivate) ───────────────────────────────────

export function useToggleUserStatus() {
  const qc    = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: "active" | "inactive" }) =>
      updateCompanyUser(id, { status }),

    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: USERS_QUERY_KEY });
      const previous = qc.getQueryData<CompanyUserWithProfile[]>(USERS_QUERY_KEY);

      qc.setQueryData<CompanyUserWithProfile[]>(USERS_QUERY_KEY, (old = []) =>
        old.map((u) => (u.id === id ? { ...u, status } as CompanyUserWithProfile : u))
      );

      return { previous };
    },

    onError: (_err, _vars, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(USERS_QUERY_KEY, ctx.previous);
      }
      toast.error(t("users.errorUpdate"));
    },

    onSuccess: (_data, vars) => {
      toast.success(
        vars.status === "active"
          ? t("users.activatedOk")
          : t("users.deactivatedOk")
      );
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: USERS_QUERY_KEY });
      qc.invalidateQueries({ queryKey: COMPANY_USERS_QUERY_KEY() });
    },
  });
}
