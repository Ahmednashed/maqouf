"use client";

import { memo } from "react";
import Link from "next/link";
import { Activity, Radio, ExternalLink, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/hooks/use-translation";
import { useActivityLogs } from "@/hooks/use-activity-logs";
import { ActivityFeedItem } from "@/components/activity/ActivityFeedItem";
import { SectionHeader, Skeleton } from "./shared";
import type { ActivityLog } from "@/types";

// ─── Entity → route ───────────────────────────────────────────────────────────

function entityHref(log: ActivityLog): string | null {
  if (log.entity_type === "visit" && log.entity_id) return `/visits/${log.entity_id}`;
  if (log.entity_type === "user")                   return "/users";
  return null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const LiveActivityFeed = memo(function LiveActivityFeed() {
  const { t, locale } = useTranslation();

  const feed = useActivityLogs();
  const logs = feed.data?.pages.flat() ?? [];

  return (
    <div>
      <SectionHeader
        title={t("dashboard.section.liveFeed")}
        icon={Activity}
        action={
          <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-emerald-600">
            <Radio className="w-3 h-3 animate-pulse" />
            LIVE
          </span>
        }
      />

      {feed.isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14" />)}
        </div>
      ) : logs.length === 0 ? (
        <div className="bg-white rounded-2xl border border-ink-100 p-8 text-center shadow-sm">
          <Activity className="w-8 h-8 text-ink-300 mx-auto mb-2" />
          <p className="text-[13px] text-ink-400">{t("activity.empty")}</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-ink-100 shadow-sm overflow-hidden">
          {logs.map((log, i) => {
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

          {feed.hasNextPage && (
            <button
              onClick={() => feed.fetchNextPage()}
              disabled={feed.isFetchingNextPage}
              className="w-full py-2.5 border-t border-ink-50 text-[12.5px] font-semibold text-brand-500 hover:bg-brand-50/50 disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
            >
              {feed.isFetchingNextPage && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {t("activity.loadMore")}
            </button>
          )}
        </div>
      )}
    </div>
  );
});
