"use client";

import { X, History } from "lucide-react";
import { useTranslation } from "@/hooks/use-translation";
import { useActorActivity } from "@/hooks/use-activity-logs";
import { ActivityTimeline } from "@/components/activity/ActivityTimeline";
import type { CompanyUserWithProfile } from "@/services/company-users";
import { memberDisplayName } from "@/services/company-users";

// ─── Props ────────────────────────────────────────────────────────────────────

interface UserActivityModalProps {
  user:    CompanyUserWithProfile;
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function UserActivityModal({ user, onClose }: UserActivityModalProps) {
  const { t } = useTranslation();
  const { data: logs = [], isLoading } = useActorActivity(user.id);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm animate-fade-in" />

      {/* Panel */}
      <div
        className="relative w-full max-w-md bg-white rounded-2xl shadow-modal border border-ink-100 animate-slide-up max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-ink-100 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center shrink-0">
              <History className="w-4 h-4 text-brand-500" />
            </div>
            <div className="min-w-0">
              <h2 className="text-[16px] font-bold text-ink-900 leading-tight">
                {t("activity.userTimeline")}
              </h2>
              <p className="text-[12px] text-ink-400 truncate leading-tight">
                {memberDisplayName(user, t("users.unknown"))}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-400 hover:text-ink-700 hover:bg-ink-100 transition-all shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Timeline (actor-scoped, so the "by …" line is redundant) */}
        <div className="px-6 py-5 overflow-y-auto">
          <ActivityTimeline logs={logs} isLoading={isLoading} showActor={false} />
        </div>
      </div>
    </div>
  );
}
