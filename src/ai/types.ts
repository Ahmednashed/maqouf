import type { SupabaseClient } from "@supabase/supabase-js";

// ─────────────────────────────────────────────────────────────────────────────
// AI Core — shared types (server-side only)
// ─────────────────────────────────────────────────────────────────────────────

export type AiLocale = "ar" | "en";

/** Chat history item accepted from the client (validated in the route). */
export interface AiChatMessage {
  role:    "user" | "assistant";
  content: string;
}

/** One executed tool call, surfaced to the UI as a "source" chip. */
export interface ToolCallRecord {
  name:     string;
  summary?: string;
}

/** A structured, clickable evidence link attached to an answer. */
export interface AiSource {
  type:       "visit" | "user" | "place" | "schedule" | "activity" | "product";
  id:         string;
  label:      string;
  href:       string;
  timestamp?: string;
}

/** A navigation-only action the agent may suggest — NEVER executed by the agent. */
export interface SuggestedAction {
  type:      string;
  label:     string;
  href?:     string;
  entityId?: string;
  requiresConfirmation: true;
}

export type EvidenceConfidence = "high" | "medium" | "low";

/** Structured route response. */
export interface AiAnswer {
  answer:           string;
  toolCalls:        ToolCallRecord[];
  sources:          AiSource[];
  suggestedActions: SuggestedAction[];
  conversationId?:  string;
  usage?: {
    inputTokens?:  number;
    outputTokens?: number;
  };
  /** Number of provider turns consumed (observability). */
  toolRounds?: number;
  /** Evidence completeness confidence (v3). */
  confidence?: EvidenceConfidence;
  /** Ids of sources matching the active entities (UI highlight). */
  activeSourceIds?: string[];
}

// Entity memory moved to entity-state.ts (normalized EntityState, v3).

/**
 * Everything a tool needs to run. The Supabase client is the AUTHENTICATED
 * server client (cookie session + anon key) — RLS is the tenant boundary,
 * so tools never receive or accept a company id.
 */
export interface ToolContext {
  supabase: SupabaseClient;
  /** Operating date, YYYY-MM-DD (validated upstream). */
  date:     string;
  locale:   AiLocale;
}

import type { ToolEntity } from "./entity-state";

/** Result of one tool execution, serialized compactly for the model. */
export interface ToolExecution {
  name:    string;
  ok:      boolean;
  /** Compact JSON payload (row-capped + truncated) or error marker. */
  data:    unknown;
  summary: string;
  /** Structured evidence links collected by the tool (UI only — stripped
      from the payload sent to the model). */
  sources?: AiSource[];
  /** Resolved entities reported by the tool (entity-grounding v3). */
  entities?: ToolEntity[];
}

/** Provider failure categories — mapped to friendly UI messages. */
export type ProviderErrorCategory = "auth" | "rate_limit" | "timeout" | "unknown";

export class ProviderError extends Error {
  category: ProviderErrorCategory;
  constructor(category: ProviderErrorCategory, message: string) {
    super(message);
    this.name = "ProviderError";
    this.category = category;
  }
}
