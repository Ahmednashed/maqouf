// ─────────────────────────────────────────────────────────────────────────────
// Tool definitions sent to the OpenAI Responses API.
// The names here are the ONLY tools the executor will run (allowlist).
// All tools are READ-ONLY in v1.
// ─────────────────────────────────────────────────────────────────────────────

export interface ToolDefinition {
  type:        "function";
  name:        string;
  description: string;
  parameters:  Record<string, unknown>;
  strict:      boolean;
}

const NO_ARGS = {
  type: "object",
  properties: {},
  additionalProperties: false,
  required: [],
} as const;

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    name: "get_dashboard_metrics",
    description:
      "Company-wide snapshot for the operating date: planned/completed/in-progress/pending/missed visit counts, completion rate %, active team members, branches, and products.",
    parameters: NO_ARGS,
    strict: true,
  },
  {
    type: "function",
    name: "get_today_visits",
    description:
      "List visits scheduled on the operating date with branch, merchandiser, status, and duration. Optionally filter by status.",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: ["string", "null"],
          enum: ["pending", "inprogress", "completed", "missed", null],
          description: "Optional status filter.",
        },
        limit: {
          type: ["integer", "null"],
          description: "Max rows (1-20). Default 20.",
        },
      },
      additionalProperties: false,
      required: ["status", "limit"],
    },
    strict: true,
  },
  {
    type: "function",
    name: "get_overdue_visits",
    description:
      "Unfinished visits (pending or in-progress) scheduled BEFORE the operating date — the operational backlog, oldest first, with total count.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: ["integer", "null"], description: "Max rows (1-20). Default 20." },
      },
      additionalProperties: false,
      required: ["limit"],
    },
    strict: true,
  },
  {
    type: "function",
    name: "get_sync_issues",
    description:
      "Active team members whose mobile app has not synced in over 24 hours (or never), with last sync and last activity timestamps.",
    parameters: NO_ARGS,
    strict: true,
  },
  {
    type: "function",
    name: "get_activity_logs",
    description:
      "Most recent audit-trail events: visit lifecycle changes (created/started/completed/missed) and user-management actions, with actor names and timestamps.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: ["integer", "null"], description: "Max rows (1-20). Default 20." },
      },
      additionalProperties: false,
      required: ["limit"],
    },
    strict: true,
  },
  {
    type: "function",
    name: "get_users",
    description:
      "Company team roster: names, roles, regions, active/inactive status, last activity and last sync. No contact details.",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: ["string", "null"],
          enum: ["active", "inactive", "all", null],
          description: "Filter by member status. Default all.",
        },
      },
      additionalProperties: false,
      required: ["status"],
    },
    strict: true,
  },
  {
    type: "function",
    name: "get_unvisited_places",
    description:
      "Active branches that have NO visit scheduled on the operating date — coverage gaps, with branch names and regions.",
    parameters: NO_ARGS,
    strict: true,
  },

  // ── v2 deep tools ───────────────────────────────────────────────────────────
  {
    type: "function",
    name: "get_user_details",
    description:
      "Look up ONE team member by (partial) name: role, region, status, last activity, last sync. If several members match, returns candidates — ASK the manager which one they meant instead of guessing.",
    parameters: {
      type: "object",
      properties: { name: { type: "string", description: "Member name or part of it." } },
      additionalProperties: false,
      required: ["name"],
    },
    strict: true,
  },
  {
    type: "function",
    name: "get_user_performance",
    description:
      "Visit performance for one member over the last N days (default 7): planned/completed/missed, completion rate, average duration, GPS-verified rate. Ambiguous names return candidates.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Member name or part of it." },
        days: { type: ["integer", "null"], description: "Look-back window 1-90 days. Default 7." },
      },
      additionalProperties: false,
      required: ["name", "days"],
    },
    strict: true,
  },
  {
    type: "function",
    name: "get_visit_details",
    description:
      "Full detail for one visit by its UUID: branch, merchandiser, status, times, duration, GPS verification, notes.",
    parameters: {
      type: "object",
      properties: { visit_id: { type: "string", description: "Visit UUID." } },
      additionalProperties: false,
      required: ["visit_id"],
    },
    strict: true,
  },
  {
    type: "function",
    name: "get_visit_timeline",
    description:
      "Chronological audit trail for one visit (created → started → completed/missed) with actor names and timestamps.",
    parameters: {
      type: "object",
      properties: { visit_id: { type: "string", description: "Visit UUID." } },
      additionalProperties: false,
      required: ["visit_id"],
    },
    strict: true,
  },
  {
    type: "function",
    name: "get_visit_products",
    description:
      "Product audit captured during one visit: per-product quantities found/missing and notes.",
    parameters: {
      type: "object",
      properties: { visit_id: { type: "string", description: "Visit UUID." } },
      additionalProperties: false,
      required: ["visit_id"],
    },
    strict: true,
  },
  {
    type: "function",
    name: "get_visit_photos",
    description:
      "Photo evidence attached to one visit — count and per-photo metadata (field, size, upload time). Use to answer 'did they upload photos?'.",
    parameters: {
      type: "object",
      properties: { visit_id: { type: "string", description: "Visit UUID." } },
      additionalProperties: false,
      required: ["visit_id"],
    },
    strict: true,
  },
  {
    type: "function",
    name: "get_schedule_details",
    description:
      "Weekly recurring visit schedule (day 0=Sunday..6=Saturday, start/end time, branch, merchandiser). Optionally filter by member name and/or branch name.",
    parameters: {
      type: "object",
      properties: {
        user_name:  { type: ["string", "null"], description: "Optional member name filter." },
        place_name: { type: ["string", "null"], description: "Optional branch name filter." },
      },
      additionalProperties: false,
      required: ["user_name", "place_name"],
    },
    strict: true,
  },
  {
    type: "function",
    name: "get_place_history",
    description:
      "Recent visit history for one branch resolved by (partial) name, newest first. Ambiguous names return candidates.",
    parameters: {
      type: "object",
      properties: {
        place_name: { type: "string", description: "Branch name or part of it (AR or EN)." },
        limit:      { type: ["integer", "null"], description: "Max rows 1-15. Default 10." },
      },
      additionalProperties: false,
      required: ["place_name", "limit"],
    },
    strict: true,
  },
  {
    type: "function",
    name: "get_stock_issues",
    description:
      "Stock problems: products reported missing during visits in the last N days (default 7) plus products expiring within 30 days.",
    parameters: {
      type: "object",
      properties: {
        days: { type: ["integer", "null"], description: "Look-back window 1-30 days. Default 7." },
      },
      additionalProperties: false,
      required: ["days"],
    },
    strict: true,
  },
  {
    type: "function",
    name: "get_template_responses",
    description:
      "Audit-form answers captured on one visit: field label, type, and compact value (photos shown as [photo]).",
    parameters: {
      type: "object",
      properties: { visit_id: { type: "string", description: "Visit UUID." } },
      additionalProperties: false,
      required: ["visit_id"],
    },
    strict: true,
  },
  {
    type: "function",
    name: "get_missing_visits",
    description:
      "Branches that SHOULD be visited today per the weekly schedule but have no visit created — schedule adherence gaps with the responsible merchandiser.",
    parameters: NO_ARGS,
    strict: true,
  },
  {
    type: "function",
    name: "compare_periods",
    description:
      "Compare operational metrics between two periods (today vs yesterday, this week vs last week, last 7 vs previous 7 days, last 30 vs previous 30). Returns current/previous/change/percentage plus whether each change is operationally positive. sync_issues is current-only (previous=null).",
    parameters: {
      type: "object",
      properties: {
        period: {
          type: "string",
          enum: ["today_vs_yesterday", "week_vs_last_week", "last7_vs_prev7", "last30_vs_prev30"],
          description: "Which comparison to run.",
        },
      },
      additionalProperties: false,
      required: ["period"],
    },
    strict: true,
  },
];

export const ALLOWED_TOOL_NAMES: ReadonlySet<string> = new Set(
  TOOL_DEFINITIONS.map((d) => d.name)
);
