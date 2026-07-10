import "server-only";
import { z } from "zod";
import { getAiConfig } from "./config";
import type { AiLocale } from "./types";
import type { EntityState } from "./entity-state";
import { entityContextForPrompt } from "./entity-state";
import { ALLOWED_TOOL_NAMES } from "./tools/definitions";
import { sanitizePlanTools } from "./planner-heuristics";
import { createStructuredTurn } from "./providers/openai";

export { shouldSkipPlanner, sanitizePlanTools } from "./planner-heuristics";

// ─────────────────────────────────────────────────────────────────────────────
// Planning layer (Phase 2). One cheap structured-output turn that decides
// intent, needed facts, and likely tools — it never answers the user and its
// output is never shown to the client. Skipped for trivial questions.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Plan contract ────────────────────────────────────────────────────────────

export const AI_INTENTS = [
  "visit_followup",
  "user_followup",
  "performance_analysis",
  "period_comparison",
  "coverage_check",
  "stock_analysis",
  "status_lookup",
  "executive_summary",
  "other",
] as const;

const planSchema = z.object({
  intent:             z.enum(AI_INTENTS),
  requiredFacts:      z.array(z.string().max(80)).max(8),
  preferredTools:     z.array(z.string().max(40)).max(6),
  needsClarification: z.boolean(),
  clarificationReason: z.string().max(160).nullable(),
  answerMode:         z.enum(["direct", "executive_analysis", "clarification"]),
});

export type AiPlan = z.infer<typeof planSchema>;

/** JSON schema mirror of planSchema for OpenAI strict structured outputs. */
const PLAN_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    intent:              { type: "string", enum: [...AI_INTENTS] },
    requiredFacts:       { type: "array", items: { type: "string" }, maxItems: 8 },
    preferredTools:      { type: "array", items: { type: "string" }, maxItems: 6 },
    needsClarification:  { type: "boolean" },
    clarificationReason: { type: ["string", "null"] },
    answerMode:          { type: "string", enum: ["direct", "executive_analysis", "clarification"] },
  },
  required: [
    "intent", "requiredFacts", "preferredTools",
    "needsClarification", "clarificationReason", "answerMode",
  ],
  additionalProperties: false,
};

// ─── Run ──────────────────────────────────────────────────────────────────────

export interface PlannerOutcome {
  plan:         AiPlan | null;   // null = planner skipped or failed
  inputTokens:  number;
  outputTokens: number;
}

export async function runPlanner(
  question: string,
  state:    EntityState | null | undefined,
  locale:   AiLocale,
  date:     string
): Promise<PlannerOutcome> {
  const cfg = getAiConfig();

  const instructions = [
    "You are the internal planning module of a field-operations assistant.",
    "You DO NOT answer the user. Output ONLY the JSON plan.",
    `Operating date: ${date}. User language: ${locale}.`,
    "",
    "Decide: intent, which facts are required, which tools (from the list) will provide them, whether clarification is needed (ambiguous person/place/visit/period), and the answer mode.",
    "Use answerMode=executive_analysis for why/compare/analysis/recommendation questions; direct for simple lookups; clarification when needsClarification is true.",
    "",
    `Available tools: ${[...ALLOWED_TOOL_NAMES].join(", ")}`,
    entityContextForPrompt(state, Date.now()),
  ].filter(Boolean).join("\n");

  try {
    const turn = await createStructuredTurn({
      instructions,
      input:           [{ role: "user", content: question }],
      schemaName:      "operations_plan",
      schema:          PLAN_JSON_SCHEMA,
      maxOutputTokens: cfg.plannerMaxOutputTokens,
      // Planner always runs on the economical model
      model:           cfg.model,
    });

    if (!turn.jsonText) {
      return { plan: null, inputTokens: turn.inputTokens, outputTokens: turn.outputTokens };
    }

    const parsed = planSchema.safeParse(JSON.parse(turn.jsonText));
    if (!parsed.success) {
      return { plan: null, inputTokens: turn.inputTokens, outputTokens: turn.outputTokens };
    }

    const plan = {
      ...parsed.data,
      preferredTools: sanitizePlanTools(parsed.data.preferredTools),
    };
    return { plan, inputTokens: turn.inputTokens, outputTokens: turn.outputTokens };
  } catch {
    // Planner failure must never break the chat — proceed unplanned
    return { plan: null, inputTokens: 0, outputTokens: 0 };
  }
}

/** Render the plan as internal guidance for the main turn (never client-visible). */
export function planGuidance(plan: AiPlan | null): string {
  if (!plan) return "";
  const lines = [
    `INTERNAL PLAN (guidance only — do not mention it): intent=${plan.intent}, mode=${plan.answerMode}.`,
  ];
  if (plan.requiredFacts.length > 0) {
    lines.push(`Facts to establish: ${plan.requiredFacts.join("; ")}.`);
  }
  if (plan.preferredTools.length > 0) {
    lines.push(`Likely useful tools: ${plan.preferredTools.join(", ")}.`);
  }
  if (plan.needsClarification && plan.clarificationReason) {
    lines.push(`Ambiguity detected: ${plan.clarificationReason} — ask a short clarification question instead of guessing.`);
  }
  return lines.join("\n");
}
