import type { ToolExecution } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Entity grounding v3 — normalized conversation entity state.
//
// Tools report resolved entities via the `__entities` convention (extracted
// by the executor, never shown to the model raw). This module merges them
// deterministically into a normalized state that is:
//   • persisted in ai_conversations.entity_context,
//   • rendered into the system prompt with IDS so follow-up questions like
//     "هل رفع صور؟" reuse activeVisit.id instead of asking for a UUID.
//
// All functions are pure and covered by the validation scenarios.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Entity reported by a tool ────────────────────────────────────────────────

export type EntityKind = "user" | "visit" | "place" | "schedule" | "product" | "period";

export interface ToolEntity {
  kind:       EntityKind;
  id:         string;
  label:      string;
  confidence: number;          // 0..1 as reported by the tool
  /** Relations (visits carry their user + place). */
  userId?:    string;
  userLabel?: string;
  placeId?:   string;
  placeLabel?: string;
  date?:      string;
  status?:    string;
  /** Periods only. */
  dateFrom?:  string;
  dateTo?:    string;
}

// ─── Normalized state ─────────────────────────────────────────────────────────

export interface ActiveEntity {
  id:         string;
  label:      string;
  confidence: number;
  resolvedAt: string;          // ISO timestamp
}

export interface ActiveVisit extends ActiveEntity {
  userId?:    string;
  userLabel?: string;
  placeId?:   string;
  placeLabel?: string;
  date?:      string;
  status?:    string;
}

export interface EntityState {
  version:        3;
  activeUser?:    ActiveEntity;
  activeVisit?:   ActiveVisit;
  activePlace?:   ActiveEntity;
  activeSchedule?: ActiveEntity;
  activeProduct?: ActiveEntity;
  lastPeriod?: {
    type:     string;
    dateFrom: string;
    dateTo:   string;
  };
}

// ─── Recency rules ────────────────────────────────────────────────────────────

/** After this window, confidence decays by DECAY_FACTOR. */
export const ENTITY_FRESH_MS  = 30 * 60 * 1000;        // 30 minutes
/** After this window, the entity is dropped entirely. */
export const ENTITY_EXPIRY_MS = 24 * 60 * 60 * 1000;   // 24 hours
const DECAY_FACTOR = 0.6;

/** Pure: effective confidence after recency decay; null when expired. */
export function effectiveConfidence(
  entity: ActiveEntity,
  nowMs:  number
): number | null {
  const age = nowMs - new Date(entity.resolvedAt).getTime();
  if (Number.isNaN(age) || age > ENTITY_EXPIRY_MS) return null;
  if (age > ENTITY_FRESH_MS) return entity.confidence * DECAY_FACTOR;
  return entity.confidence;
}

// ─── Merge ────────────────────────────────────────────────────────────────────

/** Detect the legacy v2 shape ({users:[], places:[], visit_ids:[]}) and discard it. */
export function normalizeStoredState(raw: unknown): EntityState {
  if (
    typeof raw === "object" && raw !== null &&
    (raw as Record<string, unknown>).version === 3
  ) {
    return raw as EntityState;
  }
  return { version: 3 };   // legacy or empty → fresh state
}

/**
 * Pure + deterministic: fold this turn's tool entities into the state.
 * Later executions win (they reflect the most recent user focus).
 * A visit entity also refreshes activeUser and activePlace via its relations.
 */
export function mergeEntityState(
  previous:   EntityState | null | undefined,
  executions: ToolExecution[],
  nowIso:     string
): EntityState {
  const state: EntityState = { ...(previous ?? { version: 3 }), version: 3 };

  const asActive = (e: ToolEntity): ActiveEntity => ({
    id: e.id, label: e.label, confidence: e.confidence, resolvedAt: nowIso,
  });

  for (const ex of executions) {
    if (!ex.ok) continue;
    for (const e of ex.entities ?? []) {
      switch (e.kind) {
        case "user":
          state.activeUser = asActive(e);
          break;
        case "place":
          state.activePlace = asActive(e);
          break;
        case "schedule":
          state.activeSchedule = asActive(e);
          break;
        case "product":
          state.activeProduct = asActive(e);
          break;
        case "period":
          if (e.dateFrom && e.dateTo) {
            state.lastPeriod = { type: e.label, dateFrom: e.dateFrom, dateTo: e.dateTo };
          }
          break;
        case "visit": {
          state.activeVisit = {
            ...asActive(e),
            userId:     e.userId,
            userLabel:  e.userLabel,
            placeId:    e.placeId,
            placeLabel: e.placeLabel,
            date:       e.date,
            status:     e.status,
          };
          // A resolved visit grounds its user and place too
          if (e.userId && e.userLabel) {
            state.activeUser = {
              id: e.userId, label: e.userLabel,
              confidence: e.confidence, resolvedAt: nowIso,
            };
          }
          if (e.placeId && e.placeLabel) {
            state.activePlace = {
              id: e.placeId, label: e.placeLabel,
              confidence: e.confidence, resolvedAt: nowIso,
            };
          }
          break;
        }
      }
    }
  }

  return state;
}

// ─── Follow-up resolution ─────────────────────────────────────────────────────

export interface FollowUpResolution {
  entity:     ActiveEntity | null;
  kind:       EntityKind | null;
  confidence: number;
  /** True when reuse is safe without asking. */
  usable:     boolean;
}

/**
 * Pure: resolve which stored entity a follow-up about `kind` should use.
 * usable = effective confidence ≥ minConfidence.
 */
export function resolveFollowUpEntity(
  state:         EntityState | null | undefined,
  kind:          EntityKind,
  nowMs:         number,
  minConfidence: number
): FollowUpResolution {
  const none: FollowUpResolution = { entity: null, kind: null, confidence: 0, usable: false };
  if (!state) return none;

  const pick: ActiveEntity | undefined =
    kind === "user"     ? state.activeUser :
    kind === "visit"    ? state.activeVisit :
    kind === "place"    ? state.activePlace :
    kind === "schedule" ? state.activeSchedule :
    kind === "product"  ? state.activeProduct :
    undefined;

  if (!pick) return none;

  const conf = effectiveConfidence(pick, nowMs);
  if (conf === null) return none;

  return { entity: pick, kind, confidence: conf, usable: conf >= minConfidence };
}

/**
 * Pure: should the assistant ask a clarification question?
 * True when candidates are plural, or the single resolution is too weak.
 */
export function shouldAskClarification(
  candidateCount: number,
  resolution:     FollowUpResolution | null
): boolean {
  if (candidateCount > 1) return true;
  if (candidateCount === 1) return false;
  return !(resolution?.usable ?? false);
}

// ─── Prompt rendering ─────────────────────────────────────────────────────────

/**
 * Pure: render active entities (with IDS) for the system prompt. Expired
 * entities are omitted; decayed ones are marked as older context.
 */
export function entityContextForPrompt(
  state: EntityState | null | undefined,
  nowMs: number
): string {
  if (!state) return "";
  const lines: string[] = [];

  const fmt = (name: string, e: ActiveEntity, extra = "") => {
    const conf = effectiveConfidence(e, nowMs);
    if (conf === null) return;
    const stale = conf < e.confidence ? " (older context — confirm if unsure)" : "";
    lines.push(`${name}: id=${e.id} "${e.label}"${extra}${stale}`);
  };

  if (state.activeVisit) {
    const v = state.activeVisit;
    const rel = [
      v.userLabel ? ` user="${v.userLabel}"` : "",
      v.placeLabel ? ` branch="${v.placeLabel}"` : "",
      v.date ? ` date=${v.date}` : "",
      v.status ? ` status=${v.status}` : "",
    ].join("");
    fmt("activeVisit", v, rel);
  }
  if (state.activeUser)     fmt("activeUser",     state.activeUser);
  if (state.activePlace)    fmt("activePlace",    state.activePlace);
  if (state.activeSchedule) fmt("activeSchedule", state.activeSchedule);
  if (state.activeProduct)  fmt("activeProduct",  state.activeProduct);
  if (state.lastPeriod) {
    lines.push(`lastPeriod: ${state.lastPeriod.type} (${state.lastPeriod.dateFrom} → ${state.lastPeriod.dateTo})`);
  }

  if (lines.length === 0) return "";
  return [
    "ACTIVE ENTITIES (from this conversation — REUSE THESE IDS for follow-up tool calls):",
    ...lines.map((l) => "  " + l),
    "Follow-up rules: questions like 'هل رفع صور؟' / 'what products?' / 'show timeline' refer to activeVisit — call the visit tool with its id directly. 'شو وضعه؟' refers to activeUser. NEVER ask the user for a UUID when a matching active entity exists above.",
  ].join("\n");
}

/** Kinds of entities currently resolvable (for observability). */
export function resolvedEntityKinds(state: EntityState | null | undefined): string[] {
  if (!state) return [];
  const kinds: string[] = [];
  if (state.activeUser)     kinds.push("user");
  if (state.activeVisit)    kinds.push("visit");
  if (state.activePlace)    kinds.push("place");
  if (state.activeSchedule) kinds.push("schedule");
  if (state.activeProduct)  kinds.push("product");
  if (state.lastPeriod)     kinds.push("period");
  return kinds;
}
