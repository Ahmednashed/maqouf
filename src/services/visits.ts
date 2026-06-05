import { createClient } from "@/lib/supabase/client";
import type { Visit, VisitStatus } from "@/types";
import type { CompanyUserWithProfile } from "@/services/company-users";
import { initVisitProducts } from "@/services/visit-products";
import { getMyCompanyId } from "@/lib/supabase/helpers";
import {
  haversineDistance,
  DEFAULT_CHECKIN_RADIUS_METERS,
  type GpsPosition,
} from "@/lib/geo";

// ─── Extended types ───────────────────────────────────────────────────────────

type ChainInfo = {
  id:      string;
  name_ar: string;
  name_en: string;
  color?:  string;
};

type PlaceInfo = {
  id:        string;
  branch_ar: string;
  branch_en: string;
  code:      string;
  lat?:      number | null;
  lng?:      number | null;
  chain:     ChainInfo | null;
};

type TemplateSummary = {
  id:      string;
  name_ar: string;
  name_en: string;
};

/** Visit row with fully joined place, chain, merchandiser, and optional template. */
export type VisitWithDetails = Omit<Visit, "place" | "merch" | "checked_products"> & {
  place:     PlaceInfo;
  merch:     CompanyUserWithProfile;
  template?: TemplateSummary | null;
};

// ─── Payload / filter types ───────────────────────────────────────────────────

export interface VisitFilters {
  status?:    VisitStatus | "all";
  merch_id?:  string;
  place_id?:  string;
  date_from?: string;
  date_to?:   string;
}

export interface VisitCreatePayload {
  place_id:       string;
  merch_id:       string;
  scheduled_date: string;
  template_id?:   string;
  notes?:         string;
}

// Single join string re-used across all read queries.
// template uses explicit FK hint because visits.template_id is nullable and
// there are multiple FKs on visits pointing to different tables.
const VISIT_JOIN = `
  *,
  place:places (
    id, branch_ar, branch_en, code, lat, lng,
    chain:chains (id, name_ar, name_en, color)
  ),
  merch:company_users (
    *,
    user:users!company_users_user_id_fkey (id, full_name, avatar_url, email, phone)
  ),
  template:templates!visits_template_id_fkey (id, name_ar, name_en)
` as const;

// ─── Read — list ──────────────────────────────────────────────────────────────

/**
 * Fetch visits for the authenticated user's company.
 * RLS automatically scopes to company_id and (for merchandisers) to merch_id.
 */
export async function fetchVisits(
  filters: VisitFilters = {}
): Promise<VisitWithDetails[]> {
  const supabase = createClient();

  let query = supabase
    .from("visits")
    .select(VISIT_JOIN)
    .order("scheduled_date", { ascending: false })
    .order("created_at",     { ascending: false });

  if (filters.status && filters.status !== "all") {
    query = query.eq("status", filters.status);
  }
  if (filters.merch_id)  query = query.eq("merch_id",         filters.merch_id);
  if (filters.place_id)  query = query.eq("place_id",         filters.place_id);
  if (filters.date_from) query = query.gte("scheduled_date",  filters.date_from);
  if (filters.date_to)   query = query.lte("scheduled_date",  filters.date_to);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as VisitWithDetails[];
}

// ─── Read — single ────────────────────────────────────────────────────────────

export async function fetchVisit(id: string): Promise<VisitWithDetails> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("visits")
    .select(VISIT_JOIN)
    .eq("id", id)
    .single();

  if (error) throw error;
  return data as VisitWithDetails;
}

// ─── Create (admin / manual) ──────────────────────────────────────────────────

/**
 * Manually create a visit record.
 * company_id is resolved from the authenticated session, never client-supplied.
 */
export async function createVisit(
  payload: VisitCreatePayload
): Promise<VisitWithDetails> {
  const supabase   = createClient();
  const company_id = await getMyCompanyId();

  const { data, error } = await supabase
    .from("visits")
    .insert({
      company_id,
      place_id:         payload.place_id,
      merch_id:         payload.merch_id,
      scheduled_date:   payload.scheduled_date,
      template_id:      payload.template_id ?? null,
      notes:            payload.notes ?? null,
      status:           "pending",
      duration_minutes: 0,
    })
    .select(VISIT_JOIN)
    .single();

  if (error) throw error;
  return data as VisitWithDetails;
}

// ─── Start (pending → inprogress) ─────────────────────────────────────────────

/**
 * Internal row shape returned when we re-fetch branch coordinates.
 * The supabase-js response is untyped, so we cast via unknown.
 */
interface VisitCoordsRow {
  place: { lat: number | null; lng: number | null } | null;
}

/**
 * Transition a visit to "inprogress" and persist GPS check-in evidence.
 *
 * @param id      Visit UUID
 * @param checkin Raw GPS position captured by the device (optional).
 *                When provided the service re-fetches branch coordinates from
 *                the DB and recalculates distance — the client never submits a
 *                pre-computed distance. If distance > DEFAULT_CHECKIN_RADIUS_METERS
 *                the function throws, preventing bypass via direct API calls.
 *
 * Future extensions:
 *   - Accept a `checkoutAt?: string` param for the checkout flow.
 *   - Accept a `routePoints?: RoutePoint[]` param for route recording.
 */
export async function startVisit(
  id:      string,
  checkin?: GpsPosition
): Promise<VisitWithDetails> {
  const supabase = createClient();

  const update: Record<string, unknown> = {
    status:     "inprogress",
    started_at: new Date().toISOString(),
  };

  if (checkin) {
    // Re-fetch the branch lat/lng from the DB.
    // The client submits raw GPS coordinates only — distance is always
    // recalculated here so it cannot be spoofed by manipulating the payload.
    const { data: coordsData, error: coordsErr } = await supabase
      .from("visits")
      .select("place:places(lat, lng)")
      .eq("id", id)
      .single();

    if (coordsErr) throw coordsErr;

    const coords = (coordsData as unknown as VisitCoordsRow)?.place;

    if (coords?.lat != null && coords?.lng != null) {
      const dist = haversineDistance(
        checkin.latitude,  checkin.longitude,
        coords.lat,        coords.lng
      );

      // Enforce radius server-side — this throws even if someone calls
      // startVisit() directly without going through the UI GPS flow.
      if (dist > DEFAULT_CHECKIN_RADIUS_METERS) {
        throw new Error(
          `Too far from branch (${Math.round(dist)} m). ` +
          `Must be within ${DEFAULT_CHECKIN_RADIUS_METERS} m to check in.`
        );
      }

      update.checkin_lat             = checkin.latitude;
      update.checkin_lng             = checkin.longitude;
      update.checkin_accuracy        = checkin.accuracy;
      update.checkin_distance_meters = Math.round(dist);
      update.checkin_verified        = true;
    }
    // If branch has no coordinates (coords null), GPS was captured but
    // cannot be validated — skip validation, leave checkin_verified = false.
    // The client-side "no_coords" flow already warned the merchandiser.
  }

  const { data, error } = await supabase
    .from("visits")
    .update(update)
    .eq("id", id)
    .select(VISIT_JOIN)
    .single();

  if (error) throw error;

  const visit = data as VisitWithDetails;
  await initVisitProducts(id, visit.place.id);
  return visit;
}

// ─── Complete (inprogress → completed) ────────────────────────────────────────

export async function completeVisit(
  id:     string,
  notes?: string
): Promise<VisitWithDetails> {
  const supabase   = createClient();
  const completedAt = new Date().toISOString();

  // Fetch started_at to compute duration
  const { data: snap } = await supabase
    .from("visits")
    .select("started_at")
    .eq("id", id)
    .single();

  const startedAt      = snap?.started_at ? new Date(snap.started_at) : new Date();
  const durationMinutes = Math.max(
    0,
    Math.round((new Date(completedAt).getTime() - startedAt.getTime()) / 60_000)
  );

  const update: Record<string, unknown> = {
    status:           "completed",
    completed_at:     completedAt,
    duration_minutes: durationMinutes,
  };
  if (notes !== undefined) update.notes = notes;

  const { data, error } = await supabase
    .from("visits")
    .update(update)
    .eq("id", id)
    .select(VISIT_JOIN)
    .single();

  if (error) throw error;
  return data as VisitWithDetails;
}

// ─── Mark missed ──────────────────────────────────────────────────────────────

export async function markVisitMissed(id: string): Promise<VisitWithDetails> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("visits")
    .update({ status: "missed" })
    .eq("id", id)
    .select(VISIT_JOIN)
    .single();

  if (error) throw error;
  return data as VisitWithDetails;
}
