"use client";

import { UserCheck, UserX, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/hooks/use-translation";
import { useToggleUserStatus } from "@/hooks/use-users";
import type { CompanyUserWithProfile } from "@/services/company-users";

// ─── Props ────────────────────────────────────────────────────────────────────
interface StatusModalProps {
  user:    CompanyUserWithProfile;
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────
export function StatusModal({ user, onClose }: StatusModalProps) {
  const { t }      = useTranslation();
  const toggle     = useToggleUserStatus();
  const isActive   = user.status === "active";
  const nextStatus = isActive ? "inactive" : "active";

  async function handleConfirm() {
    await toggle.mutateAsync({ id: user.id, status: nextStatus });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm animate-fade-in" />

      {/* Panel */}
      <div
        className="relative w-full max-w-sm bg-white rounded-2xl shadow-modal border border-ink-100 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 end-4 w-8 h-8 rounded-lg flex items-center justify-center text-ink-400 hover:text-ink-700 hover:bg-ink-100 transition-all"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="px-6 py-6 text-center">
          {/* Icon */}
          <div
            className={cn(
              "w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4",
              isActive ? "bg-rose-50" : "bg-emerald-50"
            )}
          >
            {isActive ? (
              <UserX className="w-7 h-7 text-rose-400" />
            ) : (
              <UserCheck className="w-7 h-7 text-emerald-500" />
            )}
          </div>

          {/* Title */}
          <h2 className="text-[16px] font-bold text-ink-900 mb-1">
            {isActive
              ? t("users.confirmDeactivateTitle")
              : t("users.confirmActivateTitle")}
          </h2>

          {/* User name */}
          <p className="text-[13px] font-semibold text-ink-600 mb-2">
            {user.user.full_name}
          </p>

          {/* Message */}
          <p className="text-[13px] text-ink-500 mb-6 leading-relaxed">
            {isActive
              ? t("users.confirmDeactivateMsg")
              : t("users.confirmActivateMsg")}
          </p>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 h-11 rounded-xl border border-ink-200 text-ink-700 text-[13.5px] font-semibold hover:bg-ink-50 transition-all"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={handleConfirm}
              disabled={toggle.isPending}
              className={cn(
                "flex-1 h-11 rounded-xl text-white text-[13.5px] font-semibold shadow-pop transition-all disabled:opacity-60 flex items-center justify-center gap-2",
                isActive
                  ? "bg-rose-500 hover:bg-rose-600"
                  : "bg-emerald-500 hover:bg-emerald-600"
              )}
            >
              {toggle.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : isActive ? (
                t("users.deactivate")
              ) : (
                t("users.activate")
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
