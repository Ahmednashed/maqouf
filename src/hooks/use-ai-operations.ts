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

// ─── Context query (context panel + mock fallback) ────────────────────────────

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

import type { AiSource, SuggestedAction } from "@/ai/types";
import { useQueryClient } from "@tanstack/react-query";
import { AI_CONVERSATIONS_KEY } from "@/hooks/use-ai-conversations";
import type { StoredAiMessage } from "@/services/ai-conversations";

export interface ToolCallInfo {
  name:     string;
  summary?: string;
}

export interface ChatMessage {
  id:         string;
  role:       "user" | "assistant";
  text:       string;
  createdAt:  number;
  /** Which operational tools produced this answer (real AI only). */
  toolCalls?: ToolCallInfo[];
  /** Structured evidence links. */
  sources?:   AiSource[];
  /** Navigation-only suggestions (never executed). */
  suggestedActions?: SuggestedAction[];
  /** Evidence completeness for this answer (v3). */
  confidence?: "high" | "medium" | "low";
  /** Source ids matching the conversation's active entities (highlighted). */
  activeSourceIds?: string[];
  /** True when this answer came from the local rule engine, not real AI. */
  isMock?:    boolean;
}

export type ChatError = "rate_limited" | "unauthorized" | "unavailable" | null;

interface ChatApiResponse {
  answer?:           string;
  toolCalls?:        ToolCallInfo[];
  sources?:          AiSource[];
  suggestedActions?: SuggestedAction[];
  confidence?:       "high" | "medium" | "low";
  activeSourceIds?:  string[];
  conversationId?:   string | null;
  error?:            string;
  fallbackAllowed?:  boolean;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Chat state over POST /api/ai/chat (server-side AI Core).
 * Session-only history. On provider failure the server may allow a
 * clearly-labeled fallback to the local rule engine (AI_MOCK_FALLBACK).
 */
export function useAiChat(context: AiOperationalContext | undefined) {
  const { locale } = useTranslation();
  const qc = useQueryClient();
  const [messages, setMessages]             = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isTyping, setIsTyping]             = useState(false);
  const [error, setError]                   = useState<ChatError>(null);
  const lastQuestionRef                     = useRef<string | null>(null);
  const abortRef                            = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const ask = useCallback(async (question: string) => {
    const q = question.trim();
    if (!q || isTyping) return;

    setError(null);
    lastQuestionRef.current = q;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(), role: "user", text: q, createdAt: Date.now(),
    };

    // History for the server: prior turns + the new question (server trims further)
    const history = [...messages, userMsg]
      .filter((m) => !m.isMock)   // never feed mock text back into the real model
      .map((m) => ({ role: m.role, content: m.text }))
      .slice(-12);

    setMessages((prev) => [...prev, userMsg]);
    setIsTyping(true);

    const push = (msg: Omit<ChatMessage, "id" | "createdAt">) =>
      setMessages((prev) => [...prev, { ...msg, id: crypto.randomUUID(), createdAt: Date.now() }]);

    try {
      abortRef.current = new AbortController();
      const res = await fetch("/api/ai/chat", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          messages: history,
          locale,
          date: todayIso(),
          conversationId: conversationId ?? undefined,
        }),
        signal:  abortRef.current.signal,
      });

      const json = (await res.json().catch(() => ({}))) as ChatApiResponse;

      if (res.ok && json.answer) {
        push({
          role: "assistant",
          text: json.answer,
          toolCalls:        json.toolCalls ?? [],
          sources:          json.sources ?? [],
          suggestedActions: json.suggestedActions ?? [],
          confidence:       json.confidence,
          activeSourceIds:  json.activeSourceIds ?? [],
        });
        if (json.conversationId && json.conversationId !== conversationId) {
          setConversationId(json.conversationId);
          // A new conversation appeared — refresh the sidebar list
          qc.invalidateQueries({ queryKey: AI_CONVERSATIONS_KEY });
        }
        return;
      }

      if (res.status === 429) { setError("rate_limited");  return; }
      if (res.status === 401) { setError("unauthorized");  return; }

      // Provider down: labeled mock fallback only when the SERVER allows it
      if (json.fallbackAllowed && context) {
        const { text } = generateMockAiResponse(q, context, locale as Locale);
        push({ role: "assistant", text, isMock: true });
        return;
      }

      setError("unavailable");
    } catch {
      setError("unavailable");
    } finally {
      setIsTyping(false);
    }
  }, [messages, isTyping, locale, context, conversationId, qc]);

  const retry = useCallback(() => {
    const q = lastQuestionRef.current;
    if (!q) return;
    // Drop the failed user message so the retried one isn't duplicated
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      return last?.role === "user" && last.text === q ? prev.slice(0, -1) : prev;
    });
    setError(null);
    // ask() re-appends the question
    void Promise.resolve().then(() => askRef.current(q));
  }, []);

  // Stable ref so retry() always calls the latest ask
  const askRef = useRef(ask);
  useEffect(() => { askRef.current = ask; }, [ask]);

  /** Start a brand-new conversation. */
  const clear = useCallback(() => {
    abortRef.current?.abort();
    setIsTyping(false);
    setError(null);
    setMessages([]);
    setConversationId(null);
    lastQuestionRef.current = null;
  }, []);

  /** Hydrate the chat from a stored conversation. */
  const loadConversation = useCallback(
    (id: string, stored: StoredAiMessage[]) => {
      abortRef.current?.abort();
      setIsTyping(false);
      setError(null);
      setConversationId(id);
      setMessages(
        stored.map((m) => ({
          id:        m.id,
          role:      m.role,
          text:      m.content,
          createdAt: new Date(m.created_at).getTime(),
          toolCalls: m.tool_calls ?? undefined,
          sources:   m.sources ?? undefined,
        }))
      );
      lastQuestionRef.current = null;
    },
    []
  );

  return { messages, conversationId, isTyping, error, ask, retry, clear, loadConversation };
}
