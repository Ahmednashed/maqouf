"use client";

import { memo, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, ExternalLink, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/hooks/use-translation";
import { useActivityLogs } from "@/hooks/use-activity-logs";
import { ActivityFeedItem } from "@/components/activity/ActivityFeedItem";
import { DashboardSection, Card, EmptyState, Skeleton } from "./shared";
import type { ActivityLog } from "@/types";

// ─── Entity → route ───────────────────────────────────────────────────────────

function entityHref(log: ActivityLog): string | null {
  if (log.entity_type === "visit" && log.entity_id) return `/visits/${log.entity_id}`;
  if (log.entity_type === "user")                   return "/users";
  return null;
}

// ─── Component ────────────────────────────────────────────────────────────────

/** How many events the feed shows before the first "load more". */
const INITIAL_VISIBLE = 6;

export const LiveActivityFeed = memo(function LiveActivityFeed() {
  const { t, locale } = useTranslation();

  const feed = useActivityLogs();
  const logs = useMemo(() => feed.data?.pages.flat() ?? [], [feed.data]);

  // The query already fetches a full page (20); show a short slice first so
  // the feed stops dominating the page, then reveal the rest in place.
  const [visible, setVisible] = useState(INITIAL_VISIBLE);
  const shown      = logs.slice(0, visible);
  const hasHidden  = logs.length > shown.length;
  const canLoadMore = hasHidden || feed.hasNextPage;

  return (
    <DashboardSection
      title={t("dashboard.section.liveFeed")}
      icon={Activity}
      fill
      action={
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-100 text-[10px] font-bold text-emerald-600 tracking-wide">
            <span className="relative flex w-2 h-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex rounded-full w-2 h-2 bg-emerald-500" />
            </span>
            LIVE
          </span>
        }
      >

      {feed.isLoading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14" />)}
        </div>
      ) : logs.length === 0 ? (
        <Card fill>
          <EmptyState icon={Activity} message={t("activity.empty")} />
        </Card>
      ) : (
        <div className="bg-white rounded-2xl border border-ink-100 shadow-sm overflow-hidden h-full flex flex-col">
          {shown.map((log, i) => {
            const href = entityHref(log);
            const item = (
              <ActivityFeedItem
                log={log}
                locale={locale}
                t={t}
                showActor={true}
                divider={i > 0}
              />
            );
            return href ? (
              <Link
                key={log.id}
                href={href}
                className={cn(
                  "block relative group hover:bg-ink-50/60 transition-colors"
                )}
              >
                {item}
                <ExternalLink className="w-3 h-3 text-ink-300 absolute top-2 end-2 opacity-0 group-hover:opacity-100 transition-opacity" />
              </Link>
            ) : (
              <div key={log.id}>{item}</div>
            );
          })}

          {canLoadMore && (
            <button
              onClick={() => {
                // Reveal already-fetched events first, then page the server.
                if (hasHidden) setVisible((v) => v + INITIAL_VISIBLE);
                else feed.fetchNextPage();
              }}
              disabled={feed.isFetchingNextPage}
              className="mt-auto w-full py-2.5 border-t border-ink-50 text-[12.5px] font-semibold text-brand-500 hover:bg-brand-50/50 disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
            >
              {feed.isFetchingNextPage && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {t("activity.loadMore")}
            </button>
          )}
        </div>
      )}
    </DashboardSection>
  );
});
