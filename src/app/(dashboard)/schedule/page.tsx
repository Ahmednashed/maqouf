import { redirect } from "next/navigation";

// ─────────────────────────────────────────────────────────────────────────────
// /schedule is retired as a destination — recurring schedules now live inside
// the Visits workspace. The route is kept (not deleted) so existing bookmarks,
// notification deep links and any external references keep working.
//
// The schedule DOMAIN is untouched: the `schedules` table, its RLS, hooks and
// services are unchanged, and ScheduleModal / DeleteModal / WeeklyView are
// still served from ./_components (underscore folders are excluded from
// routing but remain importable) by
// visits/_components/RecurringSchedulesPanel.
// ─────────────────────────────────────────────────────────────────────────────

export default function SchedulePage() {
  redirect("/visits?tab=recurring");
}
