import "server-only";
import OpenAI from "openai";
import { getAiConfig } from "../config";
import { ProviderError } from "../types";
import type { ToolDefinition } from "../tools/definitions";

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI provider — the ONLY file that touches the OpenAI SDK.
// Server-only (import "server-only" makes bundling into the client a build
// error). The API key is read from process.env at call time and never logged.
// ─────────────────────────────────────────────────────────────────────────────

let client: OpenAI | null = null;

function getClient(): OpenAI {
  const { apiKey, timeoutMs } = getAiConfig();
  if (!apiKey) {
    throw new ProviderError("auth", "OPENAI_API_KEY is not configured");
  }
  if (!client) {
    client = new OpenAI({ apiKey, timeout: timeoutMs, maxRetries: 1 });
  }
  return client;
}

// ─── Request / response shapes used by the router ─────────────────────────────

export interface ProviderToolCall {
  callId:    string;
  name:      string;
  arguments: string;   // raw JSON string — validated by the executor
}

export interface ProviderTurn {
  responseId:   string;
  text:         string | null;
  toolCalls:    ProviderToolCall[];
  inputTokens:  number;
  outputTokens: number;
}

export type ProviderInputItem =
  | { role: "user" | "assistant" | "developer"; content: string }
  | { type: "function_call_output"; call_id: string; output: string };

// ─── Calls ────────────────────────────────────────────────────────────────────

interface CreateTurnParams {
  instructions:        string;
  input:               ProviderInputItem[];
  tools:               ToolDefinition[];
  previousResponseId?: string;
  /** Model override (from config.pickModel — never hardcoded here). */
  model?:              string;
}

/**
 * One Responses-API turn. Multi-round tool calling chains turns together
 * via previous_response_id so tool outputs stay attached to their calls.
 */
export async function createProviderTurn(params: CreateTurnParams): Promise<ProviderTurn> {
  const cfg = getAiConfig();

  try {
    const response = await getClient().responses.create({
      model:              params.model ?? cfg.model,
      instructions:       params.instructions,
      input:              params.input,
      tools:              params.tools,
      max_output_tokens:  cfg.maxOutputTokens,
      previous_response_id: params.previousResponseId,
      store:              true,   // required for previous_response_id chaining
    });

    const toolCalls: ProviderToolCall[] = [];
    for (const item of response.output ?? []) {
      if (item.type === "function_call") {
        toolCalls.push({
          callId:    item.call_id,
          name:      item.name,
          arguments: item.arguments,
        });
      }
    }

    return {
      responseId:   response.id,
      text:         response.output_text || null,
      toolCalls,
      inputTokens:  response.usage?.input_tokens  ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    };
  } catch (err: unknown) {
    throw categorize(err);
  }
}

// ─── Structured-output turn (planner / executive contracts) ──────────────────

interface StructuredTurnParams {
  instructions:       string;
  input:              ProviderInputItem[];
  /** Strict JSON schema the model must satisfy. */
  schemaName:         string;
  schema:             Record<string, unknown>;
  maxOutputTokens:    number;
  model?:             string;
  previousResponseId?: string;
}

export interface StructuredTurnResult {
  responseId:   string;
  /** Raw JSON text — caller MUST Zod-validate before use. */
  jsonText:     string | null;
  inputTokens:  number;
  outputTokens: number;
}

/**
 * One structured-output turn (no tools). Used by the planner and the
 * executive-answer contract. Output conforms to the strict schema, but the
 * caller still validates with Zod — model output is untrusted.
 */
export async function createStructuredTurn(
  params: StructuredTurnParams
): Promise<StructuredTurnResult> {
  const cfg = getAiConfig();

  try {
    const response = await getClient().responses.create({
      model:             params.model ?? cfg.model,
      instructions:      params.instructions,
      input:             params.input,
      max_output_tokens: params.maxOutputTokens,
      previous_response_id: params.previousResponseId,
      store:             true,
      text: {
        format: {
          type:   "json_schema",
          name:   params.schemaName,
          schema: params.schema,
          strict: true,
        },
      },
    });

    return {
      responseId:   response.id,
      jsonText:     response.output_text || null,
      inputTokens:  response.usage?.input_tokens  ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    };
  } catch (err: unknown) {
    throw categorize(err);
  }
}

// ─── Error mapping (never leaks key or prompt contents) ───────────────────────

function categorize(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;

  if (err instanceof OpenAI.APIError) {
    if (err.status === 401 || err.status === 403) {
      return new ProviderError("auth", "AI provider rejected the API key");
    }
    if (err.status === 429) {
      return new ProviderError("rate_limit", "AI provider rate limit reached");
    }
    return new ProviderError("unknown", `AI provider error (${err.status ?? "network"})`);
  }

  const msg = err instanceof Error ? err.message : "";
  if (/timeout|timed out|abort/i.test(msg)) {
    return new ProviderError("timeout", "AI provider timed out");
  }
  return new ProviderError("unknown", "AI provider failed");
}
