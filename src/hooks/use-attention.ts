"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchCompanyAttention } from "@/services/attention";
import type { AttentionCounts } from "@/lib/attention";

/**
 * Query key includes the Riyadh day, so the counts re-fetch when the business
 * day rolls over rather than showing yesterday's staleness until something else
 * happens to invalidate them.
 */
export const COMPANY_ATTENTION_QUERY_KEY = (today: string) =>
  ["company-attention", today] as const;

export function useCompanyAttention(today: string) {
  return useQuery<AttentionCounts>({
    queryKey: COMPANY_ATTENTION_QUERY_KEY(today),
    queryFn:  () => fetchCompanyAttention(today),
  });
}
