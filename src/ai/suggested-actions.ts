import type { SuggestedAction, ToolExecution, AiLocale } from "./types";
import { MAX_SUGGESTED_ACTIONS } from "./config";

// ─────────────────────────────────────────────────────────────────────────────
// Suggested actions — pure derivation from EXECUTED tool evidence (testable).
//
// Deliberately deterministic (not model-generated) so the agent can never
// invent an action. Every action is navigation-only: the href points at an
// existing Malgoof page; nothing is executed by the agent. requiresConfirmation
// is always true by construction.
// ─────────────────────────────────────────────────────────────────────────────

interface ActionTemplate {
  type:  string;
  ar:    string;
  en:    string;
  href:  string;
}

const TEMPLATES: Record<string, ActionTemplate> = {
  open_overdue:   { type: "open_overdue",   ar: "فتح الزيارات المتأخرة", en: "Open overdue visits",  href: "/visits" },
  review_sync:    { type: "review_sync",    ar: "مراجعة مشاكل المزامنة", en: "Review sync issues",   href: "/users" },
  open_users:     { type: "open_users",     ar: "فتح ملف المستخدم",      en: "Open user profile",    href: "/users" },
  open_schedule:  { type: "open_schedule",  ar: "فتح الجدول",            en: "Open schedule",        href: "/schedule" },
  review_stock:   { type: "review_stock",   ar: "مراجعة بلاغات المخزون", en: "Review stock issues",  href: "/reports" },
  create_visit:   { type: "create_visit",   ar: "إنشاء زيارة",           en: "Create visit",         href: "/visits" },
  export_report:  { type: "export_report",  ar: "تصدير تقرير",           en: "Export report",        href: "/reports" },
};

function make(key: keyof typeof TEMPLATES, locale: AiLocale, entityId?: string): SuggestedAction {
  const tpl = TEMPLATES[key];
  return {
    type:  tpl.type,
    label: locale === "ar" ? tpl.ar : tpl.en,
    href:  tpl.href,
    entityId,
    requiresConfirmation: true,
  };
}

/** Pure: validate an action object shape (used before returning to client). */
export function isValidSuggestedAction(a: unknown): a is SuggestedAction {
  if (typeof a !== "object" || a === null) return false;
  const x = a as Record<string, unknown>;
  return (
    typeof x.type  === "string" && x.type.length  > 0 && x.type.length  <= 40 &&
    typeof x.label === "string" && x.label.length > 0 && x.label.length <= 80 &&
    (x.href === undefined || (typeof x.href === "string" && x.href.startsWith("/"))) &&
    x.requiresConfirmation === true
  );
}

/**
 * Derive suggestions from what the tools actually found this turn.
 * Evidence-driven: an action appears only when its trigger condition was
 * observed in a successful tool result.
 */
export function deriveSuggestedActions(
  executions: ToolExecution[],
  locale:     AiLocale,
  max = MAX_SUGGESTED_ACTIONS
): SuggestedAction[] {
  const out: SuggestedAction[] = [];
  const has = (name: string) => executions.find((e) => e.name === name && e.ok);
  const num = (data: unknown, key: string): number => {
    const v = (data as Record<string, unknown> | null)?.[key];
    return typeof v === "number" ? v : 0;
  };

  const overdue = has("get_overdue_visits");
  if (overdue && num(overdue.data, "total_overdue") > 0) {
    out.push(make("open_overdue", locale));
  }

  const sync = has("get_sync_issues");
  if (sync && num(sync.data, "with_sync_issues") > 0) {
    out.push(make("review_sync", locale));
  }

  const stock = has("get_stock_issues");
  if (stock && (num(stock.data, "missing_count") > 0 || num(stock.data, "expiring_count") > 0)) {
    out.push(make("review_stock", locale));
  }

  if (has("get_user_details") || has("get_user_performance")) {
    out.push(make("open_users", locale));
  }

  if (has("get_schedule_details") || has("get_missing_visits")) {
    out.push(make("open_schedule", locale));
  }

  const unvisited = has("get_unvisited_places");
  if (unvisited && num(unvisited.data, "unvisited_count") > 0) {
    out.push(make("create_visit", locale));
  }

  if (has("compare_periods") || has("get_dashboard_metrics")) {
    out.push(make("export_report", locale));
  }

  // Dedupe by type, validate, cap
  const seen = new Set<string>();
  return out
    .filter((a) => {
      if (seen.has(a.type)) return false;
      seen.add(a.type);
      return isValidSuggestedAction(a);
    })
    .slice(0, max);
}
