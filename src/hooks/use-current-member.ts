"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { UserRole } from "@/types";

export interface CurrentMember {
  userId:      string;
  email:       string;
  fullName:    string | null;
  avatarUrl:   string | null;
  displayName: string | null;
  role:        UserRole;
  color:       string;
  companyId:   string;
}

export const CURRENT_MEMBER_KEY = ["current-member"] as const;

export function useCurrentMember() {
  return useQuery<CurrentMember | null>({
    queryKey: CURRENT_MEMBER_KEY,
    staleTime: 5 * 60 * 1000,  // 5 min — rarely changes mid-session
    queryFn: async () => {
      const supabase = createClient();

      const { data: { user: authUser }, error: authErr } = await supabase.auth.getUser();
      if (authErr || !authUser) return null;

      const { data, error } = await supabase
        .from("company_users")
        .select("company_id, role, color, display_name, avatar_url, user:users!company_users_user_id_fkey(email, full_name, avatar_url)")
        .eq("user_id", authUser.id)
        .eq("status", "active")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (error || !data) return null;

      type JoinedUser = { email: string; full_name: string; avatar_url: string | null };
      const rawUser = data.user as unknown;
      const joined  = rawUser && !Array.isArray(rawUser)
        ? (rawUser as JoinedUser)
        : null;

      return {
        userId:      authUser.id,
        email:       joined?.email ?? authUser.email ?? "",
        fullName:    joined?.full_name ?? null,
        avatarUrl:   (data.avatar_url as string | null) ?? joined?.avatar_url ?? null,
        displayName: (data.display_name as string | null) ?? null,
        role:        data.role as UserRole,
        color:       (data.color as string | null) ?? "#6366F1",
        companyId:   data.company_id as string,
      };
    },
  });
}

/** The name to show in the UI for the current logged-in member. */
export function currentMemberLabel(m: CurrentMember | null | undefined): string {
  if (!m) return "";
  return (
    m.displayName?.trim() ||
    m.fullName?.trim()    ||
    m.email.split("@")[0] ||
    m.email
  );
}
