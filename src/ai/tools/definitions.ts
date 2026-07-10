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
];

export const ALLOWED_TOOL_NAMES: ReadonlySet<string> = new Set(
  TOOL_DEFINITIONS.map((d) => d.name)
);
