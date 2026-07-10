import type { ToolContext } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Shared tool helpers: fuzzy name → entity resolution.
// Team/branch lists are small, so we fetch once (row-capped) and match in JS —
// avoids ilike-on-joined-column limitations and keeps queries simple.
// ─────────────────────────────────────────────────────────────────────────────

export interface ResolvedMember {
  id:               string;
  name:             string;
  role:             string;
  region:           string | null;
  status:           string;
  last_activity_at: string | null;
  last_mobile_sync: string | null;
}

interface MemberRow {
  id:               string;
  display_name:     string | null;
  role:             string;
  region:           string | null;
  status:           string;
  last_activity_at: string | null;
  last_mobile_sync: string | null;
  user: { full_name: string } | null;
}

export interface MemberResolution {
  match:      ResolvedMember | null;
  candidates: ResolvedMember[];   // >1 → ambiguous, caller should ask
}

const norm = (s: string) => s.trim().toLowerCase();

/** Resolve a member by (partial) name. Exactly one hit → match; several → candidates. */
export async function resolveMemberByName(
  ctx:  ToolContext,
  name: string
): Promise<MemberResolution> {
  const { data, error } = await ctx.supabase
    .from("company_users")
    .select(`
      id, display_name, role, region, status, last_activity_at, last_mobile_sync,
      user:users!company_users_user_id_fkey (full_name)
    `)
    .limit(100);

  if (error) throw error;

  const q    = norm(name);
  const rows = (data ?? []) as unknown as MemberRow[];
  const all: ResolvedMember[] = rows.map((r) => ({
    id:               r.id,
    name:             r.display_name?.trim() || r.user?.full_name?.trim() || "—",
    role:             r.role,
    region:           r.region,
    status:           r.status,
    last_activity_at: r.last_activity_at,
    last_mobile_sync: r.last_mobile_sync,
  }));

  const hits  = all.filter((m) => norm(m.name).includes(q));
  const exact = hits.filter((m) => norm(m.name) === q);
  const pool  = exact.length > 0 ? exact : hits;

  return {
    match:      pool.length === 1 ? pool[0] : null,
    candidates: pool.slice(0, 5),
  };
}

export interface ResolvedPlace {
  id:        string;
  branch_ar: string;
  branch_en: string;
  region:    string | null;
}

export interface PlaceResolution {
  match:      ResolvedPlace | null;
  candidates: ResolvedPlace[];
}

/** Resolve a place by (partial) branch name, AR or EN. */
export async function resolvePlaceByName(
  ctx:  ToolContext,
  name: string
): Promise<PlaceResolution> {
  const q = name.trim();
  const { data, error } = await ctx.supabase
    .from("places")
    .select("id, branch_ar, branch_en, region")
    .or(`branch_ar.ilike.%${q.replace(/[%_,]/g, "")}%,branch_en.ilike.%${q.replace(/[%_,]/g, "")}%`)
    .limit(5);

  if (error) throw error;

  const rows = (data ?? []) as ResolvedPlace[];
  return {
    match:      rows.length === 1 ? rows[0] : null,
    candidates: rows,
  };
}

/** Display label for a place in the caller's locale. */
export function placeLabel(p: ResolvedPlace, locale: string): string {
  return locale === "ar" ? p.branch_ar : p.branch_en;
}
