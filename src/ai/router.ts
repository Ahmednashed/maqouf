import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAiConfig, pickModel, trimHistory } from "./config";
import type {
  AiAnswer, AiChatMessage, AiLocale, EvidenceConfidence, ToolContext, ToolExecution,
} from "./types";
import {
  mergeEntityState,
  normalizeStoredState,
  entityContextForPrompt,
  resolvedEntityKinds,
  type EntityState,
} from "./entity-state";
import { buildSystemPrompt } from "./prompts/operations-system";
import { buildOperationsContext } from "./context/build-operations-context";
import { TOOL_DEFINITIONS } from "./tools/definitions";
import { executeTool } from "./tools/executor";
import { dedupeSources } from "./sources";
import { deriveSuggestedActions } from "./suggested-actions";
import { runPlanner, shouldSkipPlanner, planGuidance, type AiPlan } from "./planner";
import { evaluateEvidenceCompleteness, evidenceGapInstruction } from "./evidence";
import {
  executiveAnswerSchema,
  EXECUTIVE_JSON_SCHEMA,
  renderExecutiveAnswer,
  type ExecutiveAnswer,
} from "./executive-answer";
import {
  createProviderTurn,
  createStructuredTurn,
  type ProviderInputItem,
} from "./providers/openai";

// ─────────────────────────────────────────────────────────────────────────────
// AI Core router v3 — plan → gather (tool loop + evidence check) → answer
// (plain or executive contract), with normalized entity grounding throughout.
// No chain-of-thought is stored or returned; the plan itself stays internal.
// ─────────────────────────────────────────────────────────────────────────────

export interface RunChatParams {
  supabase:     SupabaseClient;
  messages:     AiChatMessage[];
  locale:       AiLocale;
  date:         string;
  /** Raw stored entity_context (any shape — normalized here). */
  entityState?: unknown;
}

export interface RunChatResult extends AiAnswer {
  nextEntityState:        EntityState;
  intent:                 string | null;
  plannerUsed:            boolean;
  clarificationRequested: boolean;
  resolvedEntityTypes:    string[];
  /** Structured findings for persistence (executive answers only). */
  findings:               ExecutiveAnswer | null;
}

export async function runOperationsChat(params: RunChatParams): Promise<RunChatResult> {
  const { supabase, messages, locale, date } = params;
  const cfg   = getAiConfig();
  const nowMs = Date.now();

  const entityState = normalizeStoredState(params.entityState);
  const question    = messages[messages.length - 1]?.content ?? "";

  // 1. Compact upfront context (counts only)
  const ctx = await buildOperationsContext(supabase, date);

  // 2. Planner (skipped for trivial/grounded questions)
  let plan: AiPlan | null = null;
  let plannerUsed = false;
  let inputTokens  = 0;
  let outputTokens = 0;

  if (cfg.enablePlanner && !shouldSkipPlanner(question, entityState, nowMs)) {
    const outcome = await runPlanner(question, entityState, locale, date);
    plan         = outcome.plan;
    plannerUsed  = outcome.plan !== null;
    inputTokens  += outcome.inputTokens;
    outputTokens += outcome.outputTokens;
  }

  const answerMode = plan?.answerMode ?? "direct";
  const model      = pickModel(cfg, answerMode);

  // 3. Instructions: system prompt + active entities + internal plan guidance
  const instructions = [
    buildSystemPrompt({
      locale,
      date,
      contextSummary:    ctx.summary,
      degraded:          ctx.degraded,
      entityContextLine: entityContextForPrompt(entityState, nowMs),
    }),
    planGuidance(plan),
  ].filter(Boolean).join("\n\n");

  const toolCtx: ToolContext = { supabase, date, locale };

  let input: ProviderInputItem[] = trimHistory(messages).map((m) => ({
    role:    m.role,
    content: m.content,
  }));

  const executions: ToolExecution[] = [];
  let rounds = 0;
  let previousResponseId: string | undefined;
  let answer: string | null = null;
  let correctiveUsed = false;

  // 4. Tool loop — hard cap on rounds, with one evidence-driven corrective pass
  for (let round = 0; round <= cfg.maxToolRounds; round++) {
    const turn = await createProviderTurn({
      instructions,
      input,
      tools: round < cfg.maxToolRounds ? TOOL_DEFINITIONS : [],
      previousResponseId,
      model,
    });

    inputTokens  += turn.inputTokens;
    outputTokens += turn.outputTokens;
    previousResponseId = turn.responseId;
    rounds = round + 1;

    if (turn.toolCalls.length === 0) {
      // Model wants to answer — check evidence first (once, within round cap)
      if (!correctiveUsed && round < cfg.maxToolRounds && plan) {
        const assessment = evaluateEvidenceCompleteness(plan, executions);
        const gap = evidenceGapInstruction(assessment);
        if (gap) {
          correctiveUsed = true;
          input = [{ role: "developer", content: gap }];
          continue;   // one more round to gather the missing evidence
        }
      }
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

  // 5. Final evidence assessment → confidence
  const assessment = evaluateEvidenceCompleteness(plan, executions);
  const confidence: EvidenceConfidence = assessment.confidence;

  // 6. Executive contract for analytical questions (one structured turn)
  let findings: ExecutiveAnswer | null = null;
  if (
    answerMode === "executive_analysis" &&
    answer &&
    executions.some((e) => e.ok)
  ) {
    try {
      const structured = await createStructuredTurn({
        instructions:
          "Convert your previous answer into the structured executive contract. " +
          "Use ONLY facts already established by the tool results. " +
          "Mark causes 'medium' or 'low' confidence unless the evidence directly proves them. " +
          `Write all text fields in ${locale === "ar" ? "Arabic" : "English"}.`,
        input:              [{ role: "developer", content: "Produce the executive analysis object now." }],
        schemaName:         "executive_answer",
        schema:             EXECUTIVE_JSON_SCHEMA,
        maxOutputTokens:    cfg.maxOutputTokens,
        model,
        previousResponseId,
      });
      inputTokens  += structured.inputTokens;
      outputTokens += structured.outputTokens;

      if (structured.jsonText) {
        const parsed = executiveAnswerSchema.safeParse(JSON.parse(structured.jsonText));
        if (parsed.success) {
          findings = parsed.data;
          answer   = renderExecutiveAnswer(parsed.data, locale);
        }
      }
    } catch {
      // Structured pass is best-effort — keep the plain answer
    }
  }

  // 7. Entity state + structured extras
  const nowIso          = new Date(nowMs).toISOString();
  const nextEntityState = mergeEntityState(entityState, executions, nowIso);
  const sources         = dedupeSources(executions.flatMap((e) => e.sources ?? []));

  const activeIds = new Set(
    [
      nextEntityState.activeVisit?.id,
      nextEntityState.activeUser?.id,
      nextEntityState.activePlace?.id,
    ].filter(Boolean) as string[]
  );
  const activeSourceIds = sources.filter((s) => activeIds.has(s.id)).map((s) => s.id);

  return {
    answer: answer?.trim() ||
      (locale === "ar"
        ? "لم أتمكن من إكمال الإجابة — حاول إعادة صياغة السؤال."
        : "I couldn't complete the answer — try rephrasing the question."),
    toolCalls: executions.map((e) => ({ name: e.name, summary: e.summary })),
    sources,
    suggestedActions: deriveSuggestedActions(executions, locale),
    usage: { inputTokens, outputTokens },
    toolRounds: rounds,
    confidence,
    activeSourceIds,
    nextEntityState,
    intent:                 plan?.intent ?? null,
    plannerUsed,
    clarificationRequested: plan?.needsClarification ?? false,
    resolvedEntityTypes:    resolvedEntityKinds(nextEntityState),
    findings,
  };
}
