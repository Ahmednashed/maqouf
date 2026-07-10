import { z } from "zod";
import type { AiSource, ToolContext, ToolExecution } from "../types";
import type { ToolEntity } from "../entity-state";
import { MAX_FIELD_CHARS, MAX_TOOL_RESULT_CHARS } from "../config";
import { ALLOWED_TOOL_NAMES } from "./definitions";
import { getDashboardMetrics, dashboardMetricsArgs } from "./get-dashboard-metrics";
import { getTodayVisits,      todayVisitsArgs }      from "./get-today-visits";
import { getOverdueVisits,    overdueVisitsArgs }    from "./get-overdue-visits";
import { getSyncIssues,       syncIssuesArgs }       from "./get-sync-issues";
import { getActivityLogs,     activityLogsArgs }     from "./get-activity-logs";
import { getUsers,            usersArgs }            from "./get-users";
import { getUnvisitedPlaces,  unvisitedPlacesArgs }  from "./get-unvisited-places";
import { getUserDetails,      userDetailsArgs }      from "./get-user-details";
import { getUserPerformance,  userPerformanceArgs }  from "./get-user-performance";
import { getVisitDetails,     visitDetailsArgs }     from "./get-visit-details";
import { getVisitTimeline,    visitTimelineArgs }    from "./get-visit-timeline";
import { getVisitProducts,    visitProductsArgs }    from "./get-visit-products";
import { getVisitPhotos,      visitPhotosArgs }      from "./get-visit-photos";
import { getScheduleDetails,  scheduleDetailsArgs }  from "./get-schedule-details";
import { getPlaceHistory,     placeHistoryArgs }     from "./get-place-history";
import { getStockIssues,      stockIssuesArgs }      from "./get-stock-issues";
import { getTemplateResponses, templateResponsesArgs } from "./get-template-responses";
import { getMissingVisits,    missingVisitsArgs }    from "./get-missing-visits";
import { comparePeriods,      comparePeriodsArgs }   from "./compare-periods";
import { getLastVisit,        lastVisitArgs }        from "./get-last-visit";

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
  // v2 deep tools
  get_user_details:       { schema: userDetailsArgs,       run: (ctx, a) => getUserDetails(ctx, a as never) },
  get_user_performance:   { schema: userPerformanceArgs,   run: (ctx, a) => getUserPerformance(ctx, a as never) },
  get_visit_details:      { schema: visitDetailsArgs,      run: (ctx, a) => getVisitDetails(ctx, a as never) },
  get_visit_timeline:     { schema: visitTimelineArgs,     run: (ctx, a) => getVisitTimeline(ctx, a as never) },
  get_visit_products:     { schema: visitProductsArgs,     run: (ctx, a) => getVisitProducts(ctx, a as never) },
  get_visit_photos:       { schema: visitPhotosArgs,       run: (ctx, a) => getVisitPhotos(ctx, a as never) },
  get_schedule_details:   { schema: scheduleDetailsArgs,   run: (ctx, a) => getScheduleDetails(ctx, a as never) },
  get_place_history:      { schema: placeHistoryArgs,      run: (ctx, a) => getPlaceHistory(ctx, a as never) },
  get_stock_issues:       { schema: stockIssuesArgs,       run: (ctx, a) => getStockIssues(ctx, a as never) },
  get_template_responses: { schema: templateResponsesArgs, run: (ctx, a) => getTemplateResponses(ctx, a as never) },
  get_missing_visits:     { schema: missingVisitsArgs,     run: (ctx)    => getMissingVisits(ctx) },
  compare_periods:        { schema: comparePeriodsArgs,    run: (ctx, a) => comparePeriods(ctx, a as never) },
  get_last_visit:         { schema: lastVisitArgs,         run: (ctx, a) => getLastVisit(ctx, a as never) },
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

    // Extract UI/state-only channels (__sources, __entities) — never sent to the model
    const { sources, entities, cleaned } = extractSideChannels(result);
    let data = truncateDeep(cleaned);

    // Hard cap on serialized result size sent to the provider
    if (JSON.stringify(data).length > MAX_TOOL_RESULT_CHARS) {
      data = { error: "result_too_large", hint: "narrow the query (fewer rows / shorter period)" };
    }

    return { name, ok: true, data, summary: summarize(name, cleaned), sources, entities };
  } catch {
    // Never leak raw DB errors to the model or the client
    return { name, ok: false, data: { error: "tool_failed" }, summary: "failed" };
  }
}

/** Pure: split a tool result into { sources, entities, cleaned payload }. */
export function extractSideChannels(result: unknown): {
  sources:  AiSource[];
  entities: ToolEntity[];
  cleaned:  unknown;
} {
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    return { sources: [], entities: [], cleaned: result };
  }
  const { __sources, __entities, ...rest } = result as Record<string, unknown>;
  return {
    sources:  Array.isArray(__sources)  ? (__sources  as AiSource[])   : [],
    entities: Array.isArray(__entities) ? (__entities as ToolEntity[]) : [],
    cleaned:  rest,
  };
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
