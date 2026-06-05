"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Company } from "@/types";

/**
 * Returns the authenticated user's company.
 * RLS on the `companies` table automatically scopes the query —
 * no need to pass company_id explicitly.
 * Marked staleTime: Infinity because company data rarely changes
 * during a session and we don't want unnecessary refetches.
 */
export function useCompany() {
  return useQuery<Company>({
    queryKey: ["company"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("companies")
        .select("*")
        .limit(1)
        .single();

      if (error) throw error;
      return data as Company;
    },
    staleTime: Infinity,
  });
}
