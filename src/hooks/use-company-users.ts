"use client";

import { useQuery } from "@tanstack/react-query";
import {
  fetchCompanyUsers,
  type CompanyUserWithProfile,
} from "@/services/company-users";
import type { UserRole } from "@/types";

export const COMPANY_USERS_QUERY_KEY = (role?: UserRole) =>
  role ? ["company-users", role] : ["company-users"];

/** Fetch active company members, optionally filtered by role. */
export function useCompanyUsers(role?: UserRole) {
  return useQuery<CompanyUserWithProfile[]>({
    queryKey: COMPANY_USERS_QUERY_KEY(role),
    queryFn:  () => fetchCompanyUsers(role),
    staleTime: 5 * 60_000, // 5 min — user list changes infrequently
  });
}

/** Convenience: fetch only active merchandisers. */
export function useMerchandisers() {
  return useCompanyUsers("merchandiser");
}
