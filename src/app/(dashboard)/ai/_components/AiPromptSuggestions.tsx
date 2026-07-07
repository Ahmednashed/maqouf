"use client";

import { memo } from "react";
import { MessageCircleQuestion } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/lib/i18n/translations";

// ─── The 9 canonical example prompts ─────────────────────────────────────────

export const SUGGESTION_KEYS: TranslationKey[] = [
  "ai.q.today",
  "ai.q.sync",
  "ai.q.overdue",
  "ai.q.attention",
  "ai.q.summary",
  "ai.q.next",
  "ai.q.inactive",
  "ai.q.branches",
  "ai.q.executive",
] as TranslationKey[];

interface AiPromptSuggestionsProps {
  onPick:   (question: string) => void;
  disabled: boolean;
  /** Compact renders a single wrapping chip row (used above the input). */
  compact?: boolean;
}

export const AiPromptSuggestions = memo(function AiPromptSuggestions({
  onPick,
  disabled,
  compact = false,
}: AiPromptSuggestionsProps) {
  const { t } = useTranslation();
  const keys = compact ? SUGGESTION_KEYS.slice(0, 4) : SUGGESTION_KEYS;

  return (
    <div className={cn("flex flex-wrap gap-2", !compact && "justify-center")}>
      {keys.map((key) => {
        const label = t(key);
        return (
          <button
            key={key}
            onClick={() => onPick(label)}
            disabled={disabled}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border text-[12px] font-semibold",
              "px-3 py-1.5 transition-all",
              "bg-white border-ink-200 text-ink-600",
              "hover:border-violet-300 hover:text-violet-600 hover:bg-violet-50/50",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            <MessageCircleQuestion className="w-3.5 h-3.5 text-violet-400" />
            {label}
          </button>
        );
      })}
    </div>
  );
});
