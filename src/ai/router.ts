import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAiConfig, MAX_HISTORY_MESSAGES } from "./config";
import type {
  AiAnswer, AiChatMessage, AiLocale, EntityContext, ToolContext, ToolExecution,
} from "./types";
import { buildSystemPrompt } from "./prompts/operations-system";
import { buildOperationsContext } from "./context/build-operations-context";
import { TOOL_DEFINITIONS } from "./tools/definitions";
import { executeTool } from "./tools/executor";
import { dedupeSources } from "./sources";
import { deriveSuggestedActions } from "./suggested-actions";
import { mergeEntityContext, renderEntityContext } from "./memory";
import {
  createProviderTurn,
  type ProviderInputItem,
} from "./providers/openai";

// ─────────────────────────────────────────────────────────────────────────────
// AI Core router v2 — context → prompt → provider turns → tools → answer,
// now with entity memory, structured sources, and suggested actions.
// ─────────────────────────────────────────────────────────────────────────────

export interface RunChatParams {
  supabase:       SupabaseClient;    // authenticated server client (RLS active)
  messages:       AiChatMessage[];   // pre-validated by the route
  locale:         AiLocale;
  date:           string;            // YYYY-MM-DD
  /** Rolling entity context loaded from the conversation (may be null). */
  entityContext?: EntityContext | null;
}

export interface RunChatResult extends AiAnswer {
  /** Updated entity context to persist on the conversation. */
  nextEntityContext: EntityContext;
}

/** Pure + testable: trim history to the last N messages. */
export function trimHistory(
  messages: AiChatMessage[],
  max = MAX_HISTORY_MESSAGES
): AiChatMessage[] {
  return messages.slice(-max);
}

export async function runOperationsChat(params: RunChatParams): Promise<RunChatResult> {
  const { supabase, messages, locale, date, entityContext } = params;
  const cfg = getAiConfig();

  // 1. Compact upfront context (counts only)
  const ctx = await buildOperationsContext(supabase, date);

  const instructions = buildSystemPrompt({
    locale,
    date,
    contextSummary:    ctx.summary,
    degraded:          ctx.degraded,
    entityContextLine: renderEntityContext(entityContext),
  });

  const toolCtx: ToolContext = { supabase, date, locale };

  // 2. First provider turn: trimmed history
  let input: ProviderInputItem[] = trimHistory(messages).map((m) => ({
    role:    m.role,
    content: m.content,
  }));

  const executions: ToolExecution[] = [];
  let inputTokens  = 0;
  let outputTokens = 0;
  let rounds       = 0;
  let previousResponseId: string | undefined;
  let answer: string | null = null;

  // 3. Tool loop — hard cap on rounds
  for (let round = 0; round <= cfg.maxToolRounds; round++) {
    const turn = await createProviderTurn({
      instructions,
      input,
      // After the final allowed round, don't offer tools — force an answer
      tools: round < cfg.maxToolRounds ? TOOL_DEFINITIONS : [],
      previousResponseId,
    });

    inputTokens  += turn.inputTokens;
    outputTokens += turn.outputTokens;
    previousResponseId = turn.responseId;
    rounds = round + 1;

    if (turn.toolCalls.length === 0) {
      answer = turn.text;
      break;
    }

    const outputs: ProviderInputItem[] = [];
    for (const call of turn.toolCalls) {
      const result = await executeTool(call.name, call.arguments, toolCtx);
      executions.push(result);
      outputs.push({
        type:    "function_call_output",
        call_id: call.callId,
        output:  JSON.stringify(result.ok ? result.data : { error: result.summary }),
      });
    }
    input = outputs;
  }

  // 4. Assemble structured extras from tool evidence
  const sources = dedupeSources(
    executions.flatMap((e) => e.sources ?? [])
  );
  const suggestedActions  = deriveSuggestedActions(executions, locale);
  const nextEntityContext = mergeEntityContext(entityContext, executions);

  return {
    answer: answer?.trim() ||
      (locale === "ar"
        ? "لم أتمكن من إكمال الإجابة — حاول إعادة صياغة السؤال."
        : "I couldn't complete the answer — try rephrasing the question."),
    toolCalls: executions.map((e) => ({ name: e.name, summary: e.summary })),
    sources,
    suggestedActions,
    usage: { inputTokens, outputTokens },
    toolRounds: rounds,
    nextEntityContext,
  };
}
