"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchAiOperationalContext,
  generateMockAiResponse,
  type AiOperationalContext,
} from "@/services/ai-operations";
import { useTranslation } from "@/hooks/use-translation";
import type { Locale } from "@/types";

// ─── Context query ────────────────────────────────────────────────────────────

export const AI_CONTEXT_KEY = (date: string) => ["ai-context", date] as const;

export function useAiContext(date: string) {
  return useQuery<AiOperationalContext>({
    queryKey:  AI_CONTEXT_KEY(date),
    queryFn:   () => fetchAiOperationalContext(date),
    staleTime: 60_000,
    enabled:   Boolean(date),
  });
}

// ─── Chat state ───────────────────────────────────────────────────────────────

export interface ChatMessage {
  id:        string;
  role:      "user" | "assistant";
  text:      string;
  createdAt: number;
}

/**
 * Session-only chat state (no persistence in v1).
 * ask() appends the user message, waits a simulated "thinking" delay,
 * then appends the rule-based answer generated from the live context.
 */
export function useAiChat(context: AiOperationalContext | undefined) {
  const { locale } = useTranslation();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cancel a pending reply on unmount
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const ask = useCallback((question: string) => {
    const q = question.trim();
    if (!q || isTyping) return;

    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", text: q, createdAt: Date.now() },
    ]);
    setIsTyping(true);

    // Simulated thinking delay so the flow matches a real LLM later
    const delay = 900 + Math.random() * 500;
    timerRef.current = setTimeout(() => {
      setMessages((prev) => {
        if (!context) {
          return [...prev, {
            id: crypto.randomUUID(), role: "assistant" as const,
            text: locale === "ar"
              ? "ما زلت أحمّل بيانات اليوم — أعد سؤالك بعد لحظات."
              : "I'm still loading today's data — ask me again in a moment.",
            createdAt: Date.now(),
          }];
        }
        const { text } = generateMockAiResponse(q, context, locale as Locale);
        return [...prev, {
          id: crypto.randomUUID(), role: "assistant" as const,
          text, createdAt: Date.now(),
        }];
      });
      setIsTyping(false);
    }, delay);
  }, [context, isTyping, locale]);

  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setIsTyping(false);
    setMessages([]);
  }, []);

  return { messages, isTyping, ask, clear };
}
