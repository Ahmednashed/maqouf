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

/** Structured route response. */
export interface AiAnswer {
  answer:    string;
  toolCalls: ToolCallRecord[];
  usage?: {
    inputTokens?:  number;
    outputTokens?: number;
  };
}

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

/** Result of one tool execution, serialized compactly for the model. */
export interface ToolExecution {
  name:    string;
  ok:      boolean;
  /** Compact JSON payload (row-capped + truncated) or error marker. */
  data:    unknown;
  summary: string;
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
