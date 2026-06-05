import { createClient } from "@/lib/supabase/client";
import type { Schedule, DayOfWeek, ScheduleFrequency } from "@/types";
import type { CompanyUserWithProfile } from "@/services/company-users";
import { getMyCompanyId } from "@/lib/supabase/helpers";

// ─── Extended type ────────────────────────────────────────────────────────────

type ChainInfo = {
  id:      string;
  name_ar: string;
  name_en: string;
  code:    string;
  color?:  string;
};

type PlaceInfo = {
  id:        string;
  branch_ar: string;
  branch_en: string;
  code:      string;
  chain?:    ChainInfo | null;
};

/** Schedule row with joined merchandiser and place/chain for display. */
export type ScheduleWithDetails = Omit<Schedule, "merch" | "place"> & {
  merch: CompanyUserWithProfile;
  place: PlaceInfo;
};

// ─── Payload types ────────────────────────────────────────────────────────────

export interface ScheduleInsert {
  merch_id:    string;
  place_id:    string;
  day_of_week: DayOfWeek;
  start_time:  string;
  end_time?:   string;
  frequency:   ScheduleFrequency;
  is_active?:  boolean;
}

export interface ScheduleUpdate {
  merch_id?:    string;
  place_id?:    string;
  day_of_week?: DayOfWeek;
  start_time?:  string;
  end_time?:    string;
  frequency?:   ScheduleFrequency;
  is_active?:   boolean;
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Fetch all schedules for the current company.
 * Joins merchandiser profile and place/chain for display.
 * RLS scopes automatically; merchandisers see only their own rows.
 */
export async function fetchSchedules(): Promise<ScheduleWithDetails[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("schedules")
    .select(`
      *,
      merch:company_users (
        *,
        user:users!company_users_user_id_fkey (id, full_name, avatar_url)
      ),
      place:places (
        id, branch_ar, branch_en, code,
        chain:chains (id, name_ar, name_en, code, color)
      )
    `)
    .order("day_of_week", { ascending: true })
    .order("start_time",  { ascending: true });

  if (error) throw error;
  return (data ?? []) as ScheduleWithDetails[];
}

// ─── Create ───────────────────────────────────────────────────────────────────

/**
 * Create a new schedule.
 * company_id is resolved via RLS helper so the client never passes it.
 */
export async function createSchedule(payload: ScheduleInsert): Promise<Schedule> {
  const supabase   = createClient();
  const company_id = await getMyCompanyId();

  const { data, error } = await supabase
    .from("schedules")
    .insert({ ...payload, company_id })
    .select()
    .single();

  if (error) throw error;
  return data as Schedule;
}

// ─── Update ───────────────────────────────────────────────────────────────────

/**
 * Update an existing schedule.
 * RLS restricts this to owner/admin only.
 */
export async function updateSchedule(
  id:      string,
  payload: ScheduleUpdate
): Promise<Schedule> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("schedules")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data as Schedule;
}

// ─── Delete ───────────────────────────────────────────────────────────────────

/**
 * Delete a schedule.
 * RLS restricts this to owner/admin only.
 */
export async function deleteSchedule(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("schedules").delete().eq("id", id);
  if (error) throw error;
}
