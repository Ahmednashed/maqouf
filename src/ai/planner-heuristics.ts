import type { EntityState } from "./entity-state";
import { ALLOWED_TOOL_NAMES } from "./tools/definitions";

// Pure planner heuristics — separated from planner.ts (which is server-only
// because it calls the provider) so validation scenarios can import them.

const ANALYTICAL_PATTERNS =
  /why|compare|analy|trend|recommend|advise|ليش|لماذا|قارن|حلل|انصح|بتنصح|توصي|مقارنة|أداء|اداء|performance/i;

const FOLLOWUP_PATTERNS =
  /photo|product|timeline|detail|status|صور|منتجات|تفاصيل|وضعه|مساره|سجله/i;

/**
 * Pure: skip the planner when the question is a simple lookup or a direct
 * follow-up already grounded by an active entity — saves one provider call.
 */
export function shouldSkipPlanner(
  question: string,
  state:    EntityState | null | undefined,
  nowMs:    number
): boolean {
  if (ANALYTICAL_PATTERNS.test(question)) return false;   // needs planning

  // Short direct follow-up with a grounded visit/user → prompt rules suffice
  if (FOLLOWUP_PATTERNS.test(question) && question.length < 80) {
    const hasVisit = Boolean(state?.activeVisit) &&
      (nowMs - new Date(state!.activeVisit!.resolvedAt).getTime()) < 24 * 60 * 60 * 1000;
    const hasUser  = Boolean(state?.activeUser);
    if (hasVisit || hasUser) return true;
  }

  // Very short simple questions
  return question.trim().length < 40;
}

/** Pure: keep only allowlisted tools from planner output. */
export function sanitizePlanTools(tools: string[]): string[] {
  return tools.filter((t) => ALLOWED_TOOL_NAMES.has(t));
}
