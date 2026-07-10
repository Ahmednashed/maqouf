"use client";

import { memo, useState } from "react";
import { Sparkles, Copy, Check, Database, CircleSlash } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/lib/i18n/translations";
import { useCurrentMember, currentMemberLabel } from "@/hooks/use-current-member";
import type { ChatMessage } from "@/hooks/use-ai-operations";

// ─── Message bubble ───────────────────────────────────────────────────────────

export const AiMessage = memo(function AiMessage({ message }: { message: ChatMessage }) {
  const { t, locale } = useTranslation();
  const { data: me }  = useCurrentMember();
  const [copied, setCopied] = useState(false);

  const isUser = message.role === "user";
  const time   = new Date(message.createdAt).toLocaleTimeString(
    locale === "ar" ? "ar-SA" : "en-GB",
    { hour: "2-digit", minute: "2-digit" }
  );

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopied(true);
      toast.success(t("ai.copied"));
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable — ignore */ }
  }

  const userInitial = (currentMemberLabel(me)[0] ?? "?").toUpperCase();

  return (
    <div className={cn("flex items-start gap-3", isUser && "flex-row-reverse")}>
      {/* Avatar */}
      {isUser ? (
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-[12px] font-bold shrink-0"
          style={{ backgroundColor: me?.color ?? "#6366F1" }}
        >
          {userInitial}
        </div>
      ) : (
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shrink-0">
          <Sparkles className="w-4 h-4 text-white" />
        </div>
      )}

      {/* Bubble */}
      <div className={cn("group max-w-[85%] sm:max-w-[75%] min-w-0", isUser && "text-end")}>
        <div
          className={cn(
            "inline-block text-start rounded-2xl px-4 py-3 text-[13.5px] leading-relaxed whitespace-pre-wrap break-words",
            isUser
              ? "bg-brand-500 text-white rounded-te-sm shadow-pop"
              : "bg-white text-ink-800 border border-ink-100 shadow-sm rounded-ts-sm"
          )}
        >
          {message.text}
        </div>

        {/* Mock-fallback disclosure — never presented as real AI */}
        {!isUser && message.isMock && (
          <div className="mt-1.5">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-[10px] font-bold text-amber-700">
              <CircleSlash className="w-3 h-3" />
              {t("ai.mockBadge")}
            </span>
          </div>
        )}

        {/* Which operational sources the answer used */}
        {!isUser && !message.isMock && (message.toolCalls?.length ?? 0) > 0 && (
          <div className="flex flex-wrap items-center gap-1 mt-1.5">
            <span className="inline-flex items-center gap-1 text-[9.5px] font-bold text-ink-300 uppercase tracking-wide me-0.5">
              <Database className="w-2.5 h-2.5" />
              {t("ai.sourcesUsed")}:
            </span>
            {[...new Set(message.toolCalls!.map((c) => c.name))].map((name) => {
              const key   = `ai.tool.${name}` as TranslationKey;
              const label = t(key);
              return (
                <span
                  key={name}
                  className="px-1.5 py-0.5 rounded-md bg-violet-50 border border-violet-100 text-[9.5px] font-semibold text-violet-600"
                >
                  {label === key ? name : label}
                </span>
              );
            })}
          </div>
        )}

        {/* Meta row */}
        <div className={cn(
          "flex items-center gap-2 mt-1 px-1",
          isUser ? "justify-end" : "justify-start"
        )}>
          <span className="text-[10px] text-ink-300">{time}</span>
          {!isUser && (
            <button
              onClick={handleCopy}
              aria-label={t("ai.copyAnswer")}
              title={t("ai.copyAnswer")}
              className={cn(
                "inline-flex items-center gap-1 text-[10px] font-semibold text-ink-300",
                "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity",
                "hover:text-brand-500 focus-visible:outline-none"
              )}
            >
              {copied
                ? <Check className="w-3 h-3 text-emerald-500" />
                : <Copy  className="w-3 h-3" />}
              {t("ai.copyAnswer")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
