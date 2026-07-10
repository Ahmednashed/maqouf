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
  maxOutputTokens:   number;
  maxToolRounds:     number;
  dailyRequestLimit: number;
  mockFallback:      boolean;
  /** Provider call timeout in ms. */
  timeoutMs:         number;
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

export function getAiConfig(): AiConfig {
  return {
    apiKey:            process.env.OPENAI_API_KEY,
    model:             process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
    maxOutputTokens:   parseIntEnv(process.env.AI_MAX_OUTPUT_TOKENS,          700, 100, 4000),
    maxToolRounds:     parseIntEnv(process.env.AI_MAX_TOOL_ROUNDS,              3,   1,    5),
    dailyRequestLimit: parseIntEnv(process.env.AI_DAILY_REQUEST_LIMIT_PER_USER, 50,   1, 1000),
    mockFallback:      parseBoolEnv(process.env.AI_MOCK_FALLBACK, false),
    timeoutMs:         30_000,
  };
}

// ─── Request shaping limits (pure constants, used by route validation) ────────

/** Max characters per user message. */
export const MAX_QUESTION_CHARS = 1000;
/** How many trailing history messages are forwarded to the provider. */
export const MAX_HISTORY_MESSAGES = 10;
/** Max rows any tool may return. */
export const MAX_TOOL_ROWS = 20;
/** Max characters per string field inside tool results. */
export const MAX_FIELD_CHARS = 120;
