import { DashboardShell } from "./DashboardShell";

/**
 * Render every dashboard route per request instead of prerendering it.
 *
 * WHY
 * ───
 * These pages decide what to show from the clock: the dashboard greets by hour
 * and defaults to today, Reports defaults to "this month → today", Visits
 * anchors on today, the AI page dates its questions. All of it is computed
 * during render.
 *
 * Statically prerendered, that render happens once at BUILD time on Vercel and
 * the resulting HTML is then served to everyone, for as long as the deployment
 * lives. The browser re-computes the same expressions at hydration and gets
 * different answers — a stale date, the wrong greeting — so the markup did not
 * match and React reported the recoverable hydration error #418 on every load
 * in production. It was invisible locally only because a build and its test
 * happen minutes apart, inside the same day and the same greeting bucket.
 *
 * Rendering per request makes the server's "now" the visitor's "now", so both
 * sides agree. Combined with riyadhHour()/riyadhToday(), which are anchored to
 * Riyadh rather than to whatever timezone the machine is in, server and client
 * are now identical by construction rather than by coincidence.
 *
 * The cost is nil in practice: every one of these routes is behind auth, hits
 * middleware and Supabase on each request anyway, and prerendering only ever
 * produced an empty shell — the real content is client-fetched.
 *
 * This file must stay a Server Component for the export below to take effect;
 * the shell itself is the client component it wraps.
 */
export const dynamic = "force-dynamic";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}
