"use client";

import { Activity as ActivityIcon, Loader2 } from "lucide-react";
import { useTranslation } from "@/hooks/use-translation";
import { ActivityFeedItem } from "./ActivityFeedItem";
import type { ActivityLog } from "@/types";

// ─── Component ────────────────────────────────────────────────────────────────

interface ActivityTimelineProps {
  logs:       ActivityLog[];
  isLoading:  boolean;
  showActor?: boolean;
  /** Load-more wiring (only used by the infinite dashboard feed). */
  hasMore?:   boolean;
  onLoadMore?: () => void;
  isLoadingMore?: boolean;
}

export function ActivityTimeline({
  logs,
  isLoading,
  showActor = true,
  hasMore = false,
  onLoadMore,
  isLoadingMore = false,
}: ActivityTimelineProps) {
  const { t, locale } = useTranslation();

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-14 rounded-2xl bg-ink-100 animate-pulse" />
        ))}
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-ink-100 p-8 text-center shadow-sm">
        <ActivityIcon className="w-8 h-8 text-ink-300 mx-auto mb-2" />
        <p className="text-[13px] text-ink-400">{t("activity.empty")}</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-ink-100 shadow-sm overflow-hidden">
      {logs.map((log, i) => (
        <ActivityFeedItem
          key={log.id}
          log={log}
          locale={locale}
          t={t}
          showActor={showActor}
          divider={i > 0}
        />
      ))}

      {hasMore && onLoadMore && (
        <button
          onClick={onLoadMore}
          disabled={isLoadingMore}
          className="w-full py-2.5 border-t border-ink-50 text-[12.5px] font-semibold text-brand-500 hover:bg-brand-50/50 disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
        >
          {isLoadingMore && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {t("activity.loadMore")}
        </button>
      )}
    </div>
  );
}
