"use client";

import { useEffect, useState } from "react";
import {
  X,
  Link2,
  Copy,
  ExternalLink,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { toast }               from "sonner";
import { useTranslation }      from "@/hooks/use-translation";
import type { CompanyUserWithProfile } from "@/services/company-users";
import { safeUserName }        from "@/services/company-users";

// ─── Props ────────────────────────────────────────────────────────────────────

interface InvitationLinkModalProps {
  user:    CompanyUserWithProfile;
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function InvitationLinkModal({ user, onClose }: InvitationLinkModalProps) {
  const { t, locale } = useTranslation();

  const [link,    setLink]    = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [copied,  setCopied]  = useState(false);

  // Generate the link on mount
  useEffect(() => {
    let cancelled = false;

    async function generate() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/users/invite-link", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ company_user_id: user.id }),
        });

        const json = await res.json() as { link?: string; email?: string; message?: string };

        if (!res.ok) {
          if (res.status === 429 || json.message === "rate_limit") {
            setError(t("users.rateLimitError"));
          } else {
            setError(json.message ?? t("users.errorInvite"));
          }
          return;
        }

        if (!cancelled) {
          setLink(json.link ?? null);
          toast.success(t("users.invitationSentOk"));
        }
      } catch {
        if (!cancelled) setError(t("users.errorInvite"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void generate();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  async function handleCopy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success(t("users.linkCopied"));
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error(t("users.errorInvite"));
    }
  }

  function handleOpen() {
    if (!link) return;
    window.open(link, "_blank", "noopener,noreferrer");
  }

  const displayName = safeUserName(user.user);
  const email       = user.user?.email ?? "—";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm animate-fade-in" />

      {/* Panel */}
      <div
        className="relative w-full max-w-md bg-white rounded-2xl shadow-modal border border-ink-100 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-ink-100">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center">
              <Link2 className="w-4 h-4 text-brand-500" />
            </div>
            <h2 className="text-[16px] font-bold text-ink-900">
              {t("users.invitationLinkTitle")}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-400 hover:text-ink-700 hover:bg-ink-100 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* User identity */}
          <div className="flex items-center gap-3 p-3.5 rounded-xl bg-ink-50 border border-ink-100">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-[12px] shrink-0"
              style={{ backgroundColor: user.color ?? "#6366F1" }}
            >
              {(user.user?.full_name ?? "?")[0]?.toUpperCase() ?? "?"}
            </div>
            <div className="min-w-0">
              <p className="text-[13.5px] font-semibold text-ink-800 leading-tight truncate">
                {displayName}
              </p>
              <p className="text-[12px] text-ink-400 leading-tight truncate" dir="ltr">
                {email}
              </p>
            </div>
          </div>

          {/* Description */}
          <p className="text-[13px] text-ink-500 leading-relaxed">
            {t("users.invitationLinkDesc")}
          </p>

          {/* ── Loading ── */}
          {loading && (
            <div className="flex flex-col items-center gap-3 py-6">
              <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
              <p className="text-[13px] text-ink-500">{t("users.generatingLink")}</p>
            </div>
          )}

          {/* ── Error ── */}
          {!loading && error && (
            <div className="flex items-start gap-3 p-4 rounded-xl bg-rose-50 border border-rose-200">
              <AlertCircle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
              <p className="text-[13px] text-rose-700">{error}</p>
            </div>
          )}

          {/* ── Link display ── */}
          {!loading && link && (
            <div className="space-y-3">
              {/* Link box */}
              <div className="flex items-center gap-2 p-3 rounded-xl bg-ink-50 border border-ink-200">
                <p
                  className="flex-1 text-[11.5px] text-ink-600 font-mono truncate"
                  dir="ltr"
                >
                  {link}
                </p>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2">
                <button
                  onClick={handleCopy}
                  className="flex-1 h-10 rounded-xl border border-ink-200 text-ink-700 text-[13px] font-semibold hover:bg-ink-50 transition-all flex items-center justify-center gap-2"
                >
                  {copied ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      {t("users.linkCopied")}
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      {t("users.copyLink")}
                    </>
                  )}
                </button>
                <button
                  onClick={handleOpen}
                  className="flex-1 h-10 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-[13px] font-semibold shadow-pop transition-all flex items-center justify-center gap-2"
                >
                  <ExternalLink className="w-4 h-4" />
                  {t("users.openLink")}
                </button>
              </div>
            </div>
          )}

          {/* Close */}
          <button
            onClick={onClose}
            className="w-full h-10 rounded-xl border border-ink-200 text-ink-600 text-[13px] font-semibold hover:bg-ink-50 transition-all"
          >
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
