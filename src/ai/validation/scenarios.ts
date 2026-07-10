import type { ToolExecution } from "../types";
import {
  mergeEntityState,
  resolveFollowUpEntity,
  shouldAskClarification,
  entityContextForPrompt,
  normalizeStoredState,
  type EntityState,
} from "../entity-state";
import { shouldSkipPlanner, sanitizePlanTools } from "../planner-heuristics";
import { evaluateEvidenceCompleteness } from "../evidence";
import { compareMetric, summarizeComparison, resolveWindows } from "../compare";
import { buildSystemPrompt } from "../prompts/operations-system";
import { isValidSuggestedAction } from "../suggested-actions";
import { dedupeSources } from "../sources";
import { trimHistory } from "../config";
import { clampStoredMessage } from "../text-limits";

// ─────────────────────────────────────────────────────────────────────────────
// Follow-up validation scenarios (Phase 6) — pure, no network, no DB.
// Run with:  npx tsx src/ai/validation/run.ts
// ─────────────────────────────────────────────────────────────────────────────

export interface ScenarioResult {
  name:   string;
  passed: boolean;
  detail: string;
}

const NOW     = Date.now();
const NOW_ISO = new Date(NOW).toISOString();

function exec(name: string, data: unknown, entities: ToolExecution["entities"] = []): ToolExecution {
  return { name, ok: true, data, summary: "ok", entities, sources: [] };
}

function check(name: string, passed: boolean, detail: string): ScenarioResult {
  return { name, passed, detail };
}

// ─── Scenario A: last-visit follow-ups (photos / products) ────────────────────

export function scenarioA(): ScenarioResult[] {
  const results: ScenarioResult[] = [];

  // Turn 1: "من آخر مندوب عمل زيارة؟" → get_last_visit grounds everything
  const afterQ1 = mergeEntityState(null, [
    exec("get_last_visit", { found: true }, [{
      kind: "visit", id: "11111111-1111-4111-8111-111111111111",
      label: "فرع العليا", confidence: 1,
      userId: "u-1", userLabel: "أحمد",
      placeId: "p-1", placeLabel: "فرع العليا",
      date: "2026-06-19", status: "completed",
    }]),
  ], NOW_ISO);

  results.push(check(
    "A1: activeVisit set with relations",
    afterQ1.activeVisit?.id === "11111111-1111-4111-8111-111111111111" &&
    afterQ1.activeUser?.label === "أحمد" &&
    afterQ1.activePlace?.label === "فرع العليا",
    `visit=${afterQ1.activeVisit?.id?.slice(0, 8)} user=${afterQ1.activeUser?.label} place=${afterQ1.activePlace?.label}`
  ));

  // Turn 2: "شو آخر فرع زاره؟" → place already grounded
  const placeRes = resolveFollowUpEntity(afterQ1, "place", NOW, 0.8);
  results.push(check(
    "A2: place follow-up usable without new lookup",
    placeRes.usable && placeRes.entity?.label === "فرع العليا",
    `usable=${placeRes.usable} conf=${placeRes.confidence}`
  ));

  // Turn 3: "هل رفع صور؟" → visit id reusable, NO clarification, NO UUID request
  const visitRes = resolveFollowUpEntity(afterQ1, "visit", NOW, 0.8);
  results.push(check(
    "A3: photo follow-up reuses activeVisit.id (no UUID request)",
    visitRes.usable &&
    visitRes.entity?.id === "11111111-1111-4111-8111-111111111111" &&
    !shouldAskClarification(0, visitRes),
    `usable=${visitRes.usable} id=${visitRes.entity?.id?.slice(0, 8)}`
  ));

  // Turn 3 continued: prompt must carry the id + the no-UUID rule
  const promptLine = entityContextForPrompt(afterQ1, NOW);
  results.push(check(
    "A4: prompt exposes visit id + forbids UUID requests",
    promptLine.includes("11111111-1111-4111-8111-111111111111") &&
    promptLine.includes("NEVER ask the user for a UUID"),
    promptLine.split("\n")[1]?.trim() ?? ""
  ));

  // Turn 4: "شو المنتجات؟" — same grounding path; planner is safely skippable
  results.push(check(
    "A5: grounded follow-up skips planner (cost control)",
    shouldSkipPlanner("شو المنتجات التي دقق عليها؟", afterQ1, NOW) === true,
    "skip=true with activeVisit"
  ));

  return results;
}

// ─── Scenario B: user analysis chain ──────────────────────────────────────────

export function scenarioB(): ScenarioResult[] {
  const results: ScenarioResult[] = [];

  // Turn 1: "احكيلي عن أحمد"
  const afterQ1 = mergeEntityState(null, [
    exec("get_user_details", { found: true, member: { name: "أحمد" } }, [{
      kind: "user", id: "u-1", label: "أحمد", confidence: 1,
    }]),
  ], NOW_ISO);

  const userRes = resolveFollowUpEntity(afterQ1, "user", NOW, 0.8);
  results.push(check(
    "B1: activeUser preserved for 'كيف كان أداؤه؟'",
    userRes.usable && userRes.entity?.label === "أحمد",
    `usable=${userRes.usable}`
  ));

  // "ليش؟" is analytical → planner must NOT be skipped
  results.push(check(
    "B2: analytical follow-up goes through the planner",
    shouldSkipPlanner("ليش أداءه ضعيف هذا الأسبوع؟", afterQ1, NOW) === false,
    "skip=false for analytical question"
  ));

  // Evidence completeness: plan wants 3 tools, only 2 ran → medium + gap
  const plan = {
    intent: "performance_analysis" as const,
    requiredFacts: ["performance", "sync"],
    preferredTools: ["get_user_performance", "compare_periods", "get_sync_issues"],
    needsClarification: false,
    clarificationReason: null,
    answerMode: "executive_analysis" as const,
  };
  const assessment = evaluateEvidenceCompleteness(plan, [
    exec("get_user_performance", {}),
    exec("compare_periods", {}),
  ]);
  results.push(check(
    "B3: evidence gap detected → additional tool suggested",
    !assessment.complete &&
    assessment.confidence === "medium" &&
    assessment.additionalTools.includes("get_sync_issues"),
    `confidence=${assessment.confidence} missing=${assessment.additionalTools.join(",")}`
  ));

  return results;
}

// ─── Scenario C: period comparison zero handling ──────────────────────────────

export function scenarioC(): ScenarioResult[] {
  const results: ScenarioResult[] = [];

  const bothZero = compareMetric("completed_visits", 0, 0);
  results.push(check(
    "C1: prev=0 & cur=0 → no change, pct 0",
    bothZero.interpretation === "no_activity" && bothZero.change_pct === 0,
    `interp=${bothZero.interpretation}`
  ));

  const newActivity = compareMetric("completed_visits", 5, 0);
  results.push(check(
    "C2: prev=0 & cur>0 → new activity, pct unavailable",
    newActivity.interpretation === "new_activity" &&
    newActivity.change_pct === null &&
    newActivity.data_quality === "no_baseline",
    `interp=${newActivity.interpretation} pct=${newActivity.change_pct}`
  ));

  const noHistory = compareMetric("sync_issues", 2, null);
  results.push(check(
    "C3: missing history explicitly marked, never invented",
    noHistory.interpretation === "insufficient_data" && noHistory.data_quality === "no_history",
    `quality=${noHistory.data_quality}`
  ));

  const worse = compareMetric("missed_visits", 4, 2);
  results.push(check(
    "C4: inverted metric — more missed = operationally negative",
    worse.positive === false && worse.direction === "up",
    `positive=${worse.positive}`
  ));

  const summary = summarizeComparison([bothZero, newActivity, noHistory, worse]);
  results.push(check(
    "C5: summary buckets + top observations",
    summary.improved.includes("completed_visits") &&
    summary.worsened.includes("missed_visits") &&
    summary.insufficient_data.includes("sync_issues") &&
    summary.top_observations.length <= 3,
    `top=${summary.top_observations.map((o) => o.metric).join(",")}`
  ));

  const w = resolveWindows("week_vs_last_week", "2026-06-19");   // a Friday
  results.push(check(
    "C6: Monday-based week windows",
    w.current.from === "2026-06-15" && w.previous.from === "2026-06-08" && w.previous.to === "2026-06-14",
    `cur=${w.current.from}→${w.current.to} prev=${w.previous.from}→${w.previous.to}`
  ));

  return results;
}

// ─── Scenario D: ambiguity → clarification ────────────────────────────────────

export function scenarioD(): ScenarioResult[] {
  const results: ScenarioResult[] = [];

  // Two matching branches → must ask
  results.push(check(
    "D1: two place candidates → clarification required",
    shouldAskClarification(2, null) === true,
    "candidates=2"
  ));

  // One candidate → no clarification
  results.push(check(
    "D2: single candidate → proceed without asking",
    shouldAskClarification(1, null) === false,
    "candidates=1"
  ));

  // Stale entity (25h old) → expired, not reused
  const stale: EntityState = {
    version: 3,
    activeVisit: {
      id: "v-old", label: "old", confidence: 1,
      resolvedAt: new Date(NOW - 25 * 60 * 60 * 1000).toISOString(),
    },
  };
  const staleRes = resolveFollowUpEntity(stale, "visit", NOW, 0.8);
  results.push(check(
    "D3: 25h-old entity expired → clarification instead of wrong reuse",
    !staleRes.usable && shouldAskClarification(0, staleRes) === true,
    `usable=${staleRes.usable}`
  ));

  // 45-min old entity → decayed below 0.8 threshold → confirm
  const aging: EntityState = {
    version: 3,
    activeVisit: {
      id: "v-aging", label: "aging", confidence: 1,
      resolvedAt: new Date(NOW - 45 * 60 * 1000).toISOString(),
    },
  };
  const agingRes = resolveFollowUpEntity(aging, "visit", NOW, 0.8);
  results.push(check(
    "D4: decayed confidence falls below reuse threshold",
    agingRes.confidence < 0.8 && !agingRes.usable,
    `conf=${agingRes.confidence}`
  ));

  return results;
}

// ─── Guardrails: trimming, limits, unknown tools, prompt locale ───────────────

export function scenarioGuardrails(): ScenarioResult[] {
  const results: ScenarioResult[] = [];

  const many = Array.from({ length: 30 }, (_, i) => ({
    role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    content: `m${i}`,
  }));
  const trimmed = trimHistory(many, 12);
  results.push(check(
    "G1: history trimmed to last 12",
    trimmed.length === 12 && trimmed[11].content === "m29",
    `len=${trimmed.length}`
  ));

  results.push(check(
    "G2: stored message clamped",
    clampStoredMessage("x".repeat(9000), 6000).length === 6001,
    "6000 + ellipsis"
  ));

  results.push(check(
    "G3: unknown planner tools rejected",
    sanitizePlanTools(["get_last_visit", "drop_table", "fetch_url"]).join(",") === "get_last_visit",
    "only allowlisted survive"
  ));

  const ar = buildSystemPrompt({ locale: "ar", date: "2026-06-19" });
  const en = buildSystemPrompt({ locale: "en", date: "2026-06-19" });
  results.push(check(
    "G4: AR/EN prompt selection",
    ar.includes("respond in Arabic") && en.includes("respond in English"),
    "language rules present"
  ));

  results.push(check(
    "G5: suggested-action validation rejects malformed actions",
    isValidSuggestedAction({ type: "x", label: "y", requiresConfirmation: true }) === true &&
    isValidSuggestedAction({ type: "x", label: "y", requiresConfirmation: false }) === false &&
    isValidSuggestedAction({ type: "x", label: "y", href: "https://evil.example", requiresConfirmation: true }) === false,
    "confirmation + relative-href enforced"
  ));

  results.push(check(
    "G6: source dedupe by type+id",
    dedupeSources([
      { type: "visit", id: "1", label: "a", href: "/visits/1" },
      { type: "visit", id: "1", label: "b", href: "/visits/1" },
      { type: "user",  id: "1", label: "c", href: "/users" },
    ]).length === 2,
    "duplicates removed"
  ));

  results.push(check(
    "G7: legacy v2 entity_context discarded safely",
    normalizeStoredState({ users: ["أحمد"], visit_ids: ["x"] }).version === 3 &&
    normalizeStoredState({ users: ["أحمد"] }).activeVisit === undefined,
    "v2 shape → fresh v3 state"
  ));

  return results;
}

export function runAllScenarios(): ScenarioResult[] {
  return [
    ...scenarioA(),
    ...scenarioB(),
    ...scenarioC(),
    ...scenarioD(),
    ...scenarioGuardrails(),
  ];
}
