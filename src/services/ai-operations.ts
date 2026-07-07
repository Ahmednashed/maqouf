import { createClient } from "@/lib/supabase/client";
import { fetchDashboard, type DashboardData } from "@/services/dashboard";
import {
  fetchExecutiveExtras,
  presenceOf,
  hasSyncIssue,
  type ExecutiveExtras,
} from "@/services/dashboard-extras";
import { fetchActivityLogs } from "@/services/activity-logs";
import { deriveInsights, healthLabelKey, type CommandCenterInsights } from "@/lib/insights";
import type { ActivityLog, Locale } from "@/types";

// ─────────────────────────────────────────────────────────────────────────────
// AI Operations — v1 foundation.
//
// No external AI API. fetchAiOperationalContext() assembles company-scoped
// operational data through the existing anon-key services (RLS enforced),
// and generateMockAiResponse() answers with rule-based intent matching.
// Swapping in a real LLM later = replacing generateMockAiResponse only.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Context shape ────────────────────────────────────────────────────────────

export interface BranchLite {
  id:        string;
  branch_ar: string;
  branch_en: string;
}

export interface AiOperationalContext {
  date:       string;
  dashboard:  DashboardData | null;
  extras:     ExecutiveExtras | null;
  activity:   ActivityLog[];
  branches:   BranchLite[];
  insights:   CommandCenterInsights;
  /** true when at least one source failed (context is partial) */
  degraded:   boolean;
}

// ─── Context fetch ────────────────────────────────────────────────────────────

/**
 * Assemble everything the assistant can talk about, in parallel.
 * allSettled: one failing source degrades the context instead of throwing.
 * All queries run through the anon-key client — RLS scopes to the caller's
 * company automatically; no service_role key anywhere near this module.
 */
export async function fetchAiOperationalContext(
  date: string
): Promise<AiOperationalContext> {
  const supabase = createClient();

  const [dashRes, extrasRes, activityRes, branchesRes] = await Promise.allSettled([
    fetchDashboard(date),
    fetchExecutiveExtras(date),
    fetchActivityLogs({ limit: 30 }),
    supabase
      .from("places")
      .select("id, branch_ar, branch_en")
      .eq("is_active", true)
      .then(({ data, error }) => {
        if (error) throw error;
        return (data ?? []) as BranchLite[];
      }),
  ]);

  const dashboard = dashRes.status     === "fulfilled" ? dashRes.value     : null;
  const extras    = extrasRes.status   === "fulfilled" ? extrasRes.value   : null;
  const activity  = activityRes.status === "fulfilled" ? activityRes.value : [];
  const branches  = branchesRes.status === "fulfilled" ? branchesRes.value : [];

  return {
    date,
    dashboard,
    extras,
    activity,
    branches,
    insights: deriveInsights(dashboard ?? undefined, extras ?? undefined),
    degraded:
      dashRes.status === "rejected" ||
      extrasRes.status === "rejected" ||
      branchesRes.status === "rejected",
  };
}

// ─── Intent matching ──────────────────────────────────────────────────────────

export type AiIntent =
  | "today_summary"
  | "sync"
  | "overdue"
  | "attention"
  | "next_actions"
  | "inactive_users"
  | "unvisited_branches"
  | "executive"
  | "fallback";

const INTENT_PATTERNS: Array<{ intent: AiIntent; re: RegExp }> = [
  { intent: "executive",          re: /executive|تنفيذي/i },
  { intent: "unvisited_branches", re: /branch|not visited|unvisited|فروع|فرع|تُزر|تزر/i },
  { intent: "sync",               re: /sync|مزامنة|يزامن/i },
  { intent: "overdue",            re: /delay|overdue|late|متأخر|تأخر/i },
  { intent: "inactive_users",     re: /inactive|offline|غير نشط|غير متصل/i },
  { intent: "next_actions",       re: /should i do|what.*next|recommend|أفعل|إجراء|التالي/i },
  { intent: "attention",          re: /attention|who needs|intervention|انتباه|يحتاج/i },
  { intent: "today_summary",      re: /today|happened|summar|اليوم|ملخص|حدث|لخص/i },
];

export function matchIntent(question: string): AiIntent {
  for (const { intent, re } of INTENT_PATTERNS) {
    if (re.test(question)) return intent;
  }
  return "fallback";
}

// ─── Response building ────────────────────────────────────────────────────────

export interface MockAiResponse {
  intent: AiIntent;
  text:   string;
}

/** Bilingual sentence helper. */
function L(locale: Locale, ar: string, en: string): string {
  return locale === "ar" ? ar : en;
}

function nameList(names: string[], locale: Locale, max = 5): string {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  let out = shown.join(locale === "ar" ? "، " : ", ");
  if (extra > 0) out += L(locale, ` و${extra} آخرين`, ` and ${extra} more`);
  return out;
}

/**
 * Rule-based mock engine. Answers in the caller's locale using ONLY the
 * provided context. Deliberately synchronous and side-effect free.
 */
export function generateMockAiResponse(
  question: string,
  ctx:      AiOperationalContext,
  locale:   Locale
): MockAiResponse {
  const intent = matchIntent(question);
  const d      = ctx.dashboard;
  const team   = ctx.extras?.team ?? [];

  const bullets: string[] = [];
  const B = "• ";

  switch (intent) {

    case "today_summary": {
      if (!d) return { intent, text: noData(locale) };
      const online = team.filter((m) => presenceOf(m.last_activity_at) === "online").length;
      bullets.push(
        L(locale, `📋 خُطط لـ ${d.todayTotal} زيارة اليوم — اكتمل ${d.todayCompleted}، جارٍ ${d.todayInProgress}، فات ${d.todayMissed}.`,
                  `📋 ${d.todayTotal} visits were planned today — ${d.todayCompleted} completed, ${d.todayInProgress} in progress, ${d.todayMissed} missed.`),
        L(locale, `✅ معدل الإنجاز ${d.completionRate}%.`,
                  `✅ Completion rate is ${d.completionRate}%.`),
        L(locale, `👥 ${online} من أعضاء الفريق متصلون الآن.`,
                  `👥 ${online} team members are online right now.`)
      );
      const top = d.merchStats[0];
      if (top && top.completed > 0) {
        bullets.push(
          L(locale, `🏆 الأفضل أداءً: ${top.full_name} (${top.completed} زيارة مكتملة).`,
                    `🏆 Top performer: ${top.full_name} (${top.completed} completed visits).`)
        );
      }
      return { intent, text: bullets.map((b) => B + b).join("\n") };
    }

    case "sync": {
      const offenders = team.filter((m) => hasSyncIssue(m.last_mobile_sync));
      if (offenders.length === 0) {
        return { intent, text: L(locale,
          "✅ جميع أعضاء الفريق زامنوا بياناتهم خلال آخر 24 ساعة.",
          "✅ Everyone has synced within the last 24 hours.") };
      }
      const names = offenders.map((m) => m.name);
      return { intent, text: L(locale,
        `⚠️ ${offenders.length} لم يزامنوا منذ أكثر من 24 ساعة:\n${B}${nameList(names, locale)}\n\nأنصح بإرسال تذكير لهم من صفحة المستخدمين.`,
        `⚠️ ${offenders.length} member(s) haven't synced in over 24 hours:\n${B}${nameList(names, locale)}\n\nI recommend sending them a reminder from the Users page.`) };
    }

    case "overdue": {
      const overdue = ctx.extras?.overdueCount ?? 0;
      if (overdue === 0) {
        return { intent, text: L(locale,
          "✅ لا توجد زيارات متأخرة — كل الزيارات غير المكتملة مجدولة لليوم أو لاحقاً.",
          "✅ No overdue visits — all unfinished visits are scheduled for today or later.") };
      }
      return { intent, text: L(locale,
        `🔴 هناك ${overdue} زيارة متأخرة (مجدولة قبل اليوم ولم تكتمل).\n\nالأسباب الشائعة: عدم تعيين بديل عند غياب الملقوف، أو تعذّر الوصول للفرع. أنصح بمراجعتها من صفحة الزيارات وإعادة جدولتها.`,
        `🔴 There are ${overdue} overdue visits (scheduled before today and still unfinished).\n\nCommon causes: no replacement assigned when a merchandiser is absent, or the branch was unreachable. I recommend reviewing them on the Visits page and rescheduling.`) };
    }

    case "attention": {
      const items = ctx.insights.priorities.filter((p) => p.severity !== "green");
      if (items.length === 0) {
        return { intent, text: L(locale,
          "✅ لا أحد يحتاج إلى تدخل عاجل الآن — الفريق يعمل بشكل جيد.",
          "✅ Nobody needs urgent intervention right now — the team is on track.") };
      }
      const offenders = team.filter((m) => hasSyncIssue(m.last_mobile_sync)).map((m) => m.name);
      bullets.push(L(locale,
        `🚨 ${items.length} أمور تحتاج انتباهك:`,
        `🚨 ${items.length} things need your attention:`));
      if ((ctx.extras?.overdueCount ?? 0) > 0) {
        bullets.push(B + L(locale, `${ctx.extras!.overdueCount} زيارات متأخرة`, `${ctx.extras!.overdueCount} overdue visits`));
      }
      if (offenders.length > 0) {
        bullets.push(B + L(locale, `مزامنة متوقفة: ${nameList(offenders, locale, 3)}`, `Sync stalled: ${nameList(offenders, locale, 3)}`));
      }
      if ((d?.alerts.length ?? 0) > 0) {
        bullets.push(B + L(locale, `${d!.alerts.length} بلاغات نفاد مخزون`, `${d!.alerts.length} out-of-stock reports`));
      }
      return { intent, text: bullets.join("\n") };
    }

    case "next_actions": {
      const hasOverdue = (ctx.extras?.overdueCount ?? 0) > 0;
      const hasSync    = team.some((m) => hasSyncIssue(m.last_mobile_sync));
      const hasOos     = (d?.alerts.length ?? 0) > 0;
      bullets.push(L(locale, "إليك ما أنصح به بالترتيب:", "Here's what I recommend, in order:"));
      let n = 1;
      if (hasOverdue) bullets.push(`${n++}. ` + L(locale, "أعد جدولة الزيارات المتأخرة من صفحة الجداول", "Reschedule the overdue visits from the Schedule page"));
      if (hasSync)    bullets.push(`${n++}. ` + L(locale, "أرسل تذكير مزامنة للمستخدمين المتوقفين", "Send a sync reminder to the stalled users"));
      if (hasOos)     bullets.push(`${n++}. ` + L(locale, "راجع بلاغات نفاد المخزون في التقارير", "Review the out-of-stock reports in Reports"));
      bullets.push(`${n++}. ` + L(locale, "تابع مؤشر صحة الفريق في لوحة التحكم", "Keep an eye on the Team Health Score on the dashboard"));
      return { intent, text: bullets.join("\n") };
    }

    case "inactive_users": {
      const offline = team.filter((m) => presenceOf(m.last_activity_at) === "offline");
      if (offline.length === 0) {
        return { intent, text: L(locale,
          "✅ جميع أعضاء الفريق النشطين ظهروا اليوم.",
          "✅ Every active team member has shown activity today.") };
      }
      const lines = offline.slice(0, 8).map((m) =>
        B + m.name + (m.region ? ` (${m.region})` : ""));
      return { intent, text: L(locale,
        `😴 ${offline.length} أعضاء بلا نشاط اليوم:\n${lines.join("\n")}`,
        `😴 ${offline.length} member(s) with no activity today:\n${lines.join("\n")}`) };
    }

    case "unvisited_branches": {
      if (!d) return { intent, text: noData(locale) };
      const visitedIds = new Set(d.todayVisits.map((v) => v.place_id));
      const unvisited  = ctx.branches.filter((b) => !visitedIds.has(b.id));
      if (ctx.branches.length === 0) {
        return { intent, text: noData(locale) };
      }
      if (unvisited.length === 0) {
        return { intent, text: L(locale,
          "🎉 كل الفروع النشطة لديها زيارة مجدولة اليوم!",
          "🎉 Every active branch has a visit scheduled today!") };
      }
      const names = unvisited.slice(0, 8).map((b) =>
        B + (locale === "ar" ? b.branch_ar : b.branch_en));
      const extra = unvisited.length - Math.min(unvisited.length, 8);
      return { intent, text: L(locale,
        `🏪 ${unvisited.length} من أصل ${ctx.branches.length} فرعاً بلا زيارة اليوم:\n${names.join("\n")}${extra > 0 ? `\n…و${extra} فروع أخرى` : ""}`,
        `🏪 ${unvisited.length} of ${ctx.branches.length} branches have no visit today:\n${names.join("\n")}${extra > 0 ? `\n…and ${extra} more` : ""}`) };
    }

    case "executive": {
      if (!d) return { intent, text: noData(locale) };
      const score = ctx.insights.healthScore;
      const labelAr: Record<string, string> = {
        "dashboard.health.excellent": "ممتاز", "dashboard.health.good": "جيد",
        "dashboard.health.attention": "يحتاج متابعة", "dashboard.health.critical": "حرج",
      };
      const labelEn: Record<string, string> = {
        "dashboard.health.excellent": "Excellent", "dashboard.health.good": "Good",
        "dashboard.health.attention": "Needs Attention", "dashboard.health.critical": "Critical",
      };
      const key   = healthLabelKey(score);
      const label = locale === "ar" ? labelAr[key] : labelEn[key];
      const issues = ctx.insights.issueCount;
      bullets.push(
        L(locale, `📊 ملخص تنفيذي — ${ctx.date}`, `📊 Executive summary — ${ctx.date}`),
        "",
        B + L(locale, `صحة الفريق: ${score}/100 (${label})`, `Team health: ${score}/100 (${label})`),
        B + L(locale, `الزيارات: ${d.todayCompleted}/${d.todayTotal} مكتملة (${d.completionRate}%)`,
                      `Visits: ${d.todayCompleted}/${d.todayTotal} completed (${d.completionRate}%)`),
        B + L(locale, `الفريق: ${d.activeMerchs} عضو نشط عبر ${d.activeBranches} فرع`,
                      `Team: ${d.activeMerchs} active members across ${d.activeBranches} branches`),
        B + (issues > 0
          ? L(locale, `⚠️ ${issues} أمور مفتوحة تحتاج قرارك`, `⚠️ ${issues} open items need your decision`)
          : L(locale, `✅ لا توجد مشاكل حرجة`, `✅ No critical issues`))
      );
      return { intent, text: bullets.join("\n") };
    }

    case "fallback":
    default:
      return { intent: "fallback", text: L(locale,
        "لم أفهم سؤالك تماماً بعد — في هذه النسخة أجيب عن أسئلة محددة. جرّب:\n• ماذا حدث اليوم؟\n• من لم يزامن بياناته؟\n• ما الفروع التي لم تُزر؟\n• أعطني ملخصاً تنفيذياً",
        "I didn't quite catch that — in this preview I answer specific questions. Try:\n• What happened today?\n• Which users did not sync?\n• Which branches were not visited?\n• Give me an executive summary") };
  }
}

function noData(locale: Locale): string {
  return L(locale,
    "تعذر الوصول إلى البيانات المطلوبة حالياً — حاول تحديث الصفحة.",
    "I couldn't reach the data I need right now — try refreshing the page.");
}
