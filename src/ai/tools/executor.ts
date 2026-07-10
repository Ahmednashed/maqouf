import { z } from "zod";
import type { ToolContext, ToolExecution } from "../types";
import { MAX_FIELD_CHARS } from "../config";
import { ALLOWED_TOOL_NAMES } from "./definitions";
import { getDashboardMetrics, dashboardMetricsArgs } from "./get-dashboard-metrics";
import { getTodayVisits,      todayVisitsArgs }      from "./get-today-visits";
import { getOverdueVisits,    overdueVisitsArgs }    from "./get-overdue-visits";
import { getSyncIssues,       syncIssuesArgs }       from "./get-sync-issues";
import { getActivityLogs,     activityLogsArgs }     from "./get-activity-logs";
import { getUsers,            usersArgs }            from "./get-users";
import { getUnvisitedPlaces,  unvisitedPlacesArgs }  from "./get-unvisited-places";

// ─────────────────────────────────────────────────────────────────────────────
// Tool executor. Model-provided arguments are UNTRUSTED input:
//   1. name must be in the allowlist,
//   2. args must parse against the tool's Zod schema (nulls stripped first —
//      strict-mode JSON schemas make the model send explicit nulls),
//   3. results are size-capped and string-truncated before serialization.
// ─────────────────────────────────────────────────────────────────────────────

type ToolFn = (ctx: ToolContext, args: Record<string, unknown>) => Promise<unknown>;

interface RegisteredTool {
  schema: z.ZodTypeAny;
  run:    ToolFn;
}

const REGISTRY: Record<string, RegisteredTool> = {
  get_dashboard_metrics: { schema: dashboardMetricsArgs, run: (ctx)      => getDashboardMetrics(ctx) },
  get_today_visits:      { schema: todayVisitsArgs,      run: (ctx, a)   => getTodayVisits(ctx, a as never) },
  get_overdue_visits:    { schema: overdueVisitsArgs,    run: (ctx, a)   => getOverdueVisits(ctx, a as never) },
  get_sync_issues:       { schema: syncIssuesArgs,       run: (ctx)      => getSyncIssues(ctx) },
  get_activity_logs:     { schema: activityLogsArgs,     run: (ctx, a)   => getActivityLogs(ctx, a as never) },
  get_users:             { schema: usersArgs,            run: (ctx, a)   => getUsers(ctx, a as never) },
  get_unvisited_places:  { schema: unvisitedPlacesArgs,  run: (ctx)      => getUnvisitedPlaces(ctx) },
};

// ─── Pure helpers (exported for testing) ──────────────────────────────────────

/** Strip explicit nulls so `.strict()` optional schemas accept strict-mode args. */
export function stripNulls(obj: unknown): Record<string, unknown> {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return {};
  return Object.fromEntries(
    Object.entries(obj as Record<string, unknown>).filter(([, v]) => v !== null)
  );
}

/** Recursively truncate long strings inside a tool result. */
export function truncateDeep(value: unknown, maxChars = MAX_FIELD_CHARS): unknown {
  if (typeof value === "string") {
    return value.length > maxChars ? value.slice(0, maxChars) + "…" : value;
  }
  if (Array.isArray(value)) return value.map((v) => truncateDeep(v, maxChars));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, truncateDeep(v, maxChars)])
    );
  }
  return value;
}

/** Pure: is this tool name allowed? */
export function isAllowedTool(name: string): boolean {
  return ALLOWED_TOOL_NAMES.has(name) && name in REGISTRY;
}

// ─── Execution ────────────────────────────────────────────────────────────────

export async function executeTool(
  name:    string,
  rawArgs: string,
  ctx:     ToolContext
): Promise<ToolExecution> {
  if (!isAllowedTool(name)) {
    return { name, ok: false, data: { error: "unknown_tool" }, summary: "rejected" };
  }

  const tool = REGISTRY[name];

  // Parse JSON args defensively — model output is untrusted
  let parsedJson: unknown = {};
  if (rawArgs && rawArgs.trim() !== "") {
    try { parsedJson = JSON.parse(rawArgs); }
    catch { return { name, ok: false, data: { error: "invalid_json_arguments" }, summary: "invalid args" }; }
  }

  const validated = tool.schema.safeParse(stripNulls(parsedJson));
  if (!validated.success) {
    return { name, ok: false, data: { error: "invalid_arguments" }, summary: "invalid args" };
  }

  try {
    const result = await tool.run(ctx, validated.data as Record<string, unknown>);
    return { name, ok: true, data: truncateDeep(result), summary: summarize(name, result) };
  } catch {
    // Never leak raw DB errors to the model or the client
    return { name, ok: false, data: { error: "tool_failed" }, summary: "failed" };
  }
}

/** Short human summary for the UI source chips. */
function summarize(name: string, result: unknown): string {
  const r = result as Record<string, unknown>;
  switch (name) {
    case "get_dashboard_metrics": return `${r.visits_planned ?? 0} visits`;
    case "get_today_visits":      return `${r.count ?? 0} rows`;
    case "get_overdue_visits":    return `${r.total_overdue ?? 0} overdue`;
    case "get_sync_issues":       return `${r.with_sync_issues ?? 0} stale`;
    case "get_activity_logs":     return `${r.count ?? 0} events`;
    case "get_users":             return `${r.count ?? 0} members`;
    case "get_unvisited_places":  return `${r.unvisited_count ?? 0} gaps`;
    default:                      return "ok";
  }
}
