// ─────────────────────────────────────────────────────────────────────────────
// AI Core — configuration (server-side only; reads process.env)
//
// The model name lives HERE and nowhere else. Default is gpt-4o-mini:
// the most economical OpenAI model with full Responses-API + tool support.
// Override with OPENAI_MODEL when you need a stronger model.
// ─────────────────────────────────────────────────────────────────────────────

export interface AiConfig {
  apiKey:            string | undefined;
  model:             string;
  /** Optional stronger model for executive analysis (falls back to `model`). */
  reasoningModel:    string | null;
  maxOutputTokens:   number;
  maxToolRounds:     number;
  dailyRequestLimit: number;
  mockFallback:      boolean;
  /** Provider call timeout in ms. */
  timeoutMs:         number;
  /** v3 planner controls. */
  enablePlanner:          boolean;
  plannerMaxOutputTokens: number;
  minEntityConfidence:    number;
}

/** Pure + testable: parse an integer env var with clamping. */
export function parseIntEnv(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Pure + testable: parse a boolean env var ("true"/"1" → true). */
export function parseBoolEnv(raw: string | undefined, fallback = false): boolean {
  if (raw === undefined || raw === "") return fallback;
  return raw === "true" || raw === "1";
}

/** Pure + testable: parse a 0..1 float env var. */
export function parseFloat01Env(raw: string | undefined, fallback: number): number {
  const n = Number.parseFloat(raw ?? "");
  if (Number.isNaN(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

export function getAiConfig(): AiConfig {
  return {
    apiKey:            process.env.OPENAI_API_KEY,
    model:             process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
    reasoningModel:    process.env.OPENAI_REASONING_MODEL?.trim() || null,
    maxOutputTokens:   parseIntEnv(process.env.AI_MAX_OUTPUT_TOKENS,          700, 100, 4000),
    maxToolRounds:     parseIntEnv(process.env.AI_MAX_TOOL_ROUNDS,              3,   1,    5),
    dailyRequestLimit: parseIntEnv(process.env.AI_DAILY_REQUEST_LIMIT_PER_USER, 50,   1, 1000),
    mockFallback:      parseBoolEnv(process.env.AI_MOCK_FALLBACK, false),
    timeoutMs:         30_000,
    enablePlanner:          parseBoolEnv(process.env.AI_ENABLE_PLANNER, true),
    plannerMaxOutputTokens: parseIntEnv(process.env.AI_PLANNER_MAX_OUTPUT_TOKENS, 300, 100, 1000),
    minEntityConfidence:    parseFloat01Env(process.env.AI_MIN_CONFIDENCE_FOR_ENTITY_REUSE, 0.8),
  };
}

/** Pure + testable: trim chat history to the last N messages. */
export function trimHistory<T>(messages: T[], max = MAX_HISTORY_MESSAGES): T[] {
  return messages.slice(-max);
}

/**
 * Pure: which model serves this answer mode. Model names live in config only.
 * Executive analysis uses the reasoning model when configured.
 */
export function pickModel(
  cfg: Pick<AiConfig, "model" | "reasoningModel">,
  answerMode: "direct" | "executive_analysis" | "clarification"
): string {
  if (answerMode === "executive_analysis" && cfg.reasoningModel) {
    return cfg.reasoningModel;
  }
  return cfg.model;
}

// ─── Request shaping limits ───────────────────────────────────────────────────

/** Max characters per user message. */
export const MAX_QUESTION_CHARS = 1000;
/** Max rows any tool may return. */
export const MAX_TOOL_ROWS = 20;
/** Max characters per string field inside tool results. */
export const MAX_FIELD_CHARS = 120;

// ─── v2 limits (env-tunable with documented defaults) ─────────────────────────

/** How many trailing history messages are forwarded to the provider. */
export const MAX_HISTORY_MESSAGES = parseIntEnv(
  process.env.AI_MAX_HISTORY_MESSAGES, 12, 2, 40
);
/** Max structured sources returned per answer. */
export const MAX_SOURCES = parseIntEnv(process.env.AI_MAX_SOURCES, 5, 1, 12);
/** Max suggested actions returned per answer. */
export const MAX_SUGGESTED_ACTIONS = parseIntEnv(
  process.env.AI_MAX_SUGGESTED_ACTIONS, 4, 1, 8
);
/** Max characters of a message persisted to ai_messages. */
export const MAX_STORED_MESSAGE_CHARS = parseIntEnv(
  process.env.AI_MAX_STORED_MESSAGE_CHARS, 6000, 500, 20000
);
/** Max characters of a serialized tool result sent to the provider. */
export const MAX_TOOL_RESULT_CHARS = parseIntEnv(
  process.env.AI_MAX_TOOL_RESULT_CHARS, 8000, 1000, 40000
);
