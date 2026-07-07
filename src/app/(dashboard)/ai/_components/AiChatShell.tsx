"use client";

import { useState, useRef, useEffect } from "react";
import { Sparkles, SendHorizonal, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/hooks/use-translation";
import { useAiChat } from "@/hooks/use-ai-operations";
import type { AiOperationalContext } from "@/services/ai-operations";
import { AiMessage }           from "./AiMessage";
import { AiTypingIndicator }   from "./AiTypingIndicator";
import { AiPromptSuggestions } from "./AiPromptSuggestions";

// ─── Chat shell: messages + input ─────────────────────────────────────────────

interface AiChatShellProps {
  context?: AiOperationalContext;
}

export function AiChatShell({ context }: AiChatShellProps) {
  const { t } = useTranslation();
  const { messages, isTyping, ask, clear } = useAiChat(context);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  // Auto-scroll to the newest message
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, isTyping]);

  function send(text?: string) {
    const q = (text ?? input).trim();
    if (!q || isTyping) return;
    ask(q);
    setInput("");
    inputRef.current?.focus();
  }

  const isEmpty = messages.length === 0;

  return (
    <div className="bg-ink-50/60 rounded-2xl border border-ink-100 shadow-sm flex flex-col h-[calc(100vh-220px)] min-h-[480px] overflow-hidden">

      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-white border-b border-ink-100 shrink-0">
        <span className="inline-flex items-center gap-2 text-[12.5px] font-bold text-ink-700">
          <span className="w-6 h-6 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
            <Sparkles className="w-3 h-3 text-white" />
          </span>
          {t("ai.assistantName")}
          <span className="px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 text-[9.5px] font-bold uppercase tracking-wide">
            {t("ai.previewBadge")}
          </span>
        </span>

        {!isEmpty && (
          <button
            onClick={clear}
            aria-label={t("ai.clearChat")}
            title={t("ai.clearChat")}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[11px] font-semibold text-ink-400 hover:text-rose-500 hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 transition-all"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t("ai.clearChat")}
          </button>
        )}
      </div>

      {/* Messages / empty state */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5 space-y-5">
        {isEmpty ? (
          <div className="h-full flex flex-col items-center justify-center gap-4 px-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg">
              <Sparkles className="w-7 h-7 text-white" />
            </div>
            <div className="text-center">
              <h2 className="text-[17px] font-bold text-ink-900">{t("ai.emptyTitle")}</h2>
              <p className="text-[12.5px] text-ink-400 mt-1 max-w-sm">{t("ai.emptyDesc")}</p>
            </div>
            <AiPromptSuggestions onPick={send} disabled={isTyping} />
          </div>
        ) : (
          <>
            {messages.map((m) => <AiMessage key={m.id} message={m} />)}
            {isTyping && <AiTypingIndicator />}
          </>
        )}
      </div>

      {/* Compact suggestions above the input (once a chat has started) */}
      {!isEmpty && (
        <div className="px-4 pb-2 shrink-0">
          <AiPromptSuggestions onPick={send} disabled={isTyping} compact />
        </div>
      )}

      {/* Input bar */}
      <div className="p-3 bg-white border-t border-ink-100 shrink-0">
        <form
          onSubmit={(e) => { e.preventDefault(); send(); }}
          className="flex items-center gap-2"
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("ai.inputPlaceholder")}
            aria-label={t("ai.inputPlaceholder")}
            className={cn(
              "flex-1 h-11 px-4 rounded-xl border border-ink-200 bg-ink-50/60 text-[13.5px] text-ink-800",
              "placeholder:text-ink-300 outline-none transition-all",
              "focus:border-violet-400 focus:ring-2 focus:ring-violet-50 focus:bg-white"
            )}
          />
          <button
            type="submit"
            disabled={!input.trim() || isTyping}
            aria-label={t("ai.send")}
            className={cn(
              "w-11 h-11 rounded-xl flex items-center justify-center text-white shrink-0",
              "bg-gradient-to-br from-violet-500 to-indigo-600 shadow-pop",
              "transition-all hover:opacity-90 active:scale-95",
              "disabled:opacity-40 disabled:cursor-not-allowed",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2"
            )}
          >
            <SendHorizonal className="w-[18px] h-[18px] rtl:rotate-180" />
          </button>
        </form>
      </div>
    </div>
  );
}
