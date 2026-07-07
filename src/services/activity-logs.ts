import { createClient } from "@/lib/supabase/client";
import { getMyCompanyId } from "@/lib/supabase/helpers";
import type { ActivityLog, ActivityAction, ActivityEntityType } from "@/types";

// ─── Filters ──────────────────────────────────────────────────────────────────

export interface ActivityLogFilters {
  entityType?: ActivityEntityType | string;
  entityId?:   string;
  actorId?:    string;
  /** Keyset cursor: return rows strictly older than this ISO timestamp. */
  before?:     string;
  limit?:      number;
}

const DEFAULT_LIMIT = 20;

/**
 * True when the error means activity_logs hasn't been migrated yet
 * (Postgres 42P01 "undefined_table" or PostgREST PGRST205 schema-cache miss).
 * Callers treat this as "no logs" so the UI never crashes pre-migration.
 */
function isMissingTable(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /relation .* does not exist/i.test(error.message ?? "") ||
    /could not find the table/i.test(error.message ?? "")
  );
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Fetch activity logs, newest first, with keyset pagination on created_at.
 * RLS scopes to the caller's company automatically.
 *
 * Returns [] (instead of throwing) when the table doesn't exist yet, so
 * deploys ahead of the migration degrade to an empty feed.
 */
export async function fetchActivityLogs(
  filters: ActivityLogFilters = {}
): Promise<ActivityLog[]> {
  const supabase = createClient();
  const limit    = filters.limit ?? DEFAULT_LIMIT;

  let query = supabase
    .from("activity_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (filters.entityType) query = query.eq("entity_type", filters.entityType);
  if (filters.entityId)   query = query.eq("entity_id",   filters.entityId);
  if (filters.actorId)    query = query.eq("actor_id",    filters.actorId);
  if (filters.before)     query = query.lt("created_at",  filters.before);

  const { data, error } = await query;

  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  return (data ?? []) as ActivityLog[];
}

// ─── Write (client-side events triggers can't see) ────────────────────────────

export interface LogActivityInput {
  action:       ActivityAction | string;
  entityType:   ActivityEntityType | string;
  entityId?:    string;
  entityLabel?: string;
  details?:     Record<string, unknown>;
}

/**
 * Record a client-originated event (e.g. 'user.invited', 'user.updated').
 * DB triggers already cover visit lifecycle and user status/role changes —
 * only call this for actions the database can't observe.
 *
 * Fire-and-forget by design: any failure (including a missing table) is
 * swallowed after a console.warn. Activity logging must never break the
 * action it describes.
 */
export async function logActivity(input: LogActivityInput): Promise<void> {
  try {
    const supabase   = createClient();
    const company_id = await getMyCompanyId();

    // Snapshot the actor's display name (same philosophy as the DB triggers)
    const { data: { user: authUser } } = await supabase.auth.getUser();
    let actor_id: string | null   = null;
    let actor_name: string | null = null;

    if (authUser) {
      const { data: me } = await supabase
        .from("company_users")
        .select("id, display_name, user:users!company_users_user_id_fkey(full_name)")
        .eq("user_id", authUser.id)
        .eq("company_id", company_id)
        .limit(1)
        .maybeSingle();

      if (me) {
        actor_id = me.id as string;
        const joined = me.user as unknown as { full_name: string } | null;
        actor_name = (me.display_name as string | null) ?? joined?.full_name ?? null;
      }
    }

    const { error } = await supabase.from("activity_logs").insert({
      company_id,
      actor_id,
      actor_name,
      action:       input.action,
      entity_type:  input.entityType,
      entity_id:    input.entityId ?? null,
      entity_label: input.entityLabel ?? null,
      details:      input.details ?? null,
    });

    if (error && !isMissingTable(error)) {
      console.warn("[activity-log]", error.message);
    }
  } catch (err) {
    console.warn("[activity-log]", err instanceof Error ? err.message : err);
  }
}
