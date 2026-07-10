import type { ToolExecution, EvidenceConfidence } from "./types";
import type { AiPlan } from "./planner";

// ─────────────────────────────────────────────────────────────────────────────
// Evidence completeness (Phase 3) — pure heuristic, deliberately NOT an LLM
// call: deterministic, free, and testable.
// ─────────────────────────────────────────────────────────────────────────────

export interface EvidenceAssessment {
  complete:        boolean;
  missingFacts:    string[];
  confidence:      EvidenceConfidence;
  /** Allowlisted tools that could fill the gaps (subset of plan.preferredTools). */
  additionalTools: string[];
}

/**
 * Pure: did the gathered tool evidence cover the plan?
 *  • every preferred tool that ran successfully counts as covered
 *  • failed/missing preferred tools become gaps
 *  • confidence: high = all covered, medium = ≥half, low = less
 * Without a plan, confidence derives from tool success ratio alone.
 */
export function evaluateEvidenceCompleteness(
  plan:       AiPlan | null,
  executions: ToolExecution[]
): EvidenceAssessment {
  const ranOk   = new Set(executions.filter((e) => e.ok).map((e) => e.name));
  const failed  = executions.filter((e) => !e.ok).map((e) => e.name);

  if (!plan || plan.preferredTools.length === 0) {
    const total = executions.length;
    const okCount = ranOk.size;
    const confidence: EvidenceConfidence =
      total === 0 ? "high" :                    // no tools needed (context answer)
      failed.length === 0 ? "high" :
      okCount >= failed.length ? "medium" : "low";
    return {
      complete: failed.length === 0,
      missingFacts: failed.map((f) => `tool_failed:${f}`),
      confidence,
      additionalTools: [],
    };
  }

  const missingTools = plan.preferredTools.filter((t) => !ranOk.has(t));
  const coveredCount = plan.preferredTools.length - missingTools.length;
  const ratio        = coveredCount / plan.preferredTools.length;

  const confidence: EvidenceConfidence =
    ratio >= 1   ? "high" :
    ratio >= 0.5 ? "medium" : "low";

  return {
    complete:        missingTools.length === 0,
    missingFacts:    missingTools.map((t) => `not_gathered:${t}`),
    confidence,
    additionalTools: missingTools,
  };
}

/** Render the gap as a corrective instruction for one extra tool round. */
export function evidenceGapInstruction(
  assessment: EvidenceAssessment
): string {
  if (assessment.complete || assessment.additionalTools.length === 0) return "";
  return (
    `EVIDENCE GAP: the following tools were planned but not yet used successfully: ` +
    `${assessment.additionalTools.join(", ")}. Call them now if they help answer the question; ` +
    `otherwise state explicitly what information is missing. Never invent a cause.`
  );
}
