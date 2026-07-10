import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAiConfig, MAX_QUESTION_CHARS, MAX_HISTORY_MESSAGES } from "@/ai/config";
import { runOperationsChat } from "@/ai/router";
import { loadOrCreateConversation, persistExchange } from "@/ai/memory";
import { ProviderError } from "@/ai/types";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/chat — the only door between the browser and the AI Core.
//
// v2 additions: conversation persistence (ai_conversations/ai_messages),
// entity-context follow-ups, structured sources + suggested actions,
// and request logging (ai_request_logs) — all fire-safe: memory or logging
// failures never break the answer.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";

const bodySchema = z.object({
  messages: z
    .array(
      z.object({
        role:    z.enum(["user", "assistant"]),
        content: z.string().min(1).max(MAX_QUESTION_CHARS),
      })
    )
    .min(1)
    .max(MAX_HISTORY_MESSAGES * 3),   // sanity bound; router trims further
  locale:         z.enum(["ar", "en"]),
  date:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  conversationId: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8);
  const startedAt = Date.now();
  const cfg       = getAiConfig();

  // Populated as the request progresses so the catch block can log context
  let conversationId: string | null = null;
  let userId: string | null = null;

  const supabase = await createClient();

  const writeLog = (params: {
    toolNames:   string[];
    toolRounds:  number;
    inputTokens: number;
    outputTokens: number;
    success:     boolean;
    errorCategory: string | null;
    intent?:                 string | null;
    plannerUsed?:            boolean;
    evidenceConfidence?:     string | null;
    clarificationRequested?: boolean;
    resolvedEntityTypes?:    string[];
  }) => {
    supabase
      .rpc("log_ai_request", {
        p_conversation_id: conversationId,
        p_request_id:      requestId,
        p_model:           cfg.model,
        p_tool_names:      params.toolNames,
        p_tool_rounds:     params.toolRounds,
        p_duration_ms:     Date.now() - startedAt,
        p_input_tokens:    params.inputTokens,
        p_output_tokens:   params.outputTokens,
        p_success:         params.success,
        p_error_category:  params.errorCategory,
        p_intent:                  params.intent ?? null,
        p_planner_used:            params.plannerUsed ?? false,
        p_evidence_confidence:     params.evidenceConfidence ?? null,
        p_clarification_requested: params.clarificationRequested ?? false,
        p_resolved_entity_types:   params.resolvedEntityTypes ?? [],
      })
      .then(({ error }) => {
        if (error && error.code !== "42883" && error.code !== "PGRST202") {
          console.warn(`[ai:${requestId}] request log failed: ${error.code}`);
        }
      });
  };

  try {
    // ── 1. Auth ──────────────────────────────────────────────────────────
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    userId = user.id;

    // ── 2. Validate input ────────────────────────────────────────────────
    let raw: unknown;
    try { raw = await request.json(); }
    catch { return NextResponse.json({ error: "invalid_body" }, { status: 400 }); }

    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }
    const { messages, locale } = parsed.data;
    const date = parsed.data.date ?? new Date().toISOString().slice(0, 10);

    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role !== "user") {
      return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }

    // ── 3. Daily rate limit (server-side, atomic) ────────────────────────
    const { data: countResult, error: rpcErr } = await supabase.rpc(
      "check_and_increment_ai_usage",
      { p_limit: cfg.dailyRequestLimit }
    );
    if (rpcErr) {
      console.warn(`[ai:${requestId}] usage RPC unavailable: ${rpcErr.code}`);
    } else if (countResult === -1) {
      console.info(`[ai:${requestId}] user=${userId} rate-limited`);
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }

    // ── 4. Conversation memory (graceful pre-migration degradation) ──────
    const conversation = await loadOrCreateConversation(
      supabase,
      parsed.data.conversationId,
      lastMessage.content,
      locale
    );
    conversationId = conversation?.id ?? null;

    // ── 5. Run the AI Core ───────────────────────────────────────────────
    const result = await runOperationsChat({
      supabase,
      messages,
      locale,
      date,
      entityState: conversation?.entity_context ?? null,
    });

    // ── 6. Persist exchange + tokens + request log (all fire-safe) ───────
    if (conversation) {
      void persistExchange(
        supabase, conversation, lastMessage.content, result,
        result.nextEntityState, result.findings ?? undefined
      );
    }
    if (result.usage?.inputTokens || result.usage?.outputTokens) {
      supabase
        .rpc("record_ai_tokens", {
          p_input:  result.usage.inputTokens  ?? 0,
          p_output: result.usage.outputTokens ?? 0,
        })
        .then(({ error }) => {
          if (error) console.warn(`[ai:${requestId}] token recording failed`);
        });
    }
    writeLog({
      toolNames:    result.toolCalls.map((c) => c.name),
      toolRounds:   result.toolRounds ?? 0,
      inputTokens:  result.usage?.inputTokens  ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
      success:      true,
      errorCategory: null,
      intent:                 result.intent,
      plannerUsed:            result.plannerUsed,
      evidenceConfidence:     result.confidence ?? null,
      clarificationRequested: result.clarificationRequested,
      resolvedEntityTypes:    result.resolvedEntityTypes,
    });

    console.info(
      `[ai:${requestId}] user=${userId} conv=${conversationId ?? "-"} ` +
      `intent=${result.intent ?? "-"} planner=${result.plannerUsed} conf=${result.confidence} ` +
      `tools=[${result.toolCalls.map((c) => c.name).join(",")}] rounds=${result.toolRounds} ` +
      `in=${result.usage?.inputTokens ?? 0} out=${result.usage?.outputTokens ?? 0} ` +
      `ms=${Date.now() - startedAt}`
    );

    // Entity state and findings are server-internal; the client gets the
    // rendered answer + structured extras only
    return NextResponse.json({
      answer:           result.answer,
      toolCalls:        result.toolCalls,
      sources:          result.sources,
      suggestedActions: result.suggestedActions,
      confidence:       result.confidence,
      activeSourceIds:  result.activeSourceIds,
      conversationId,
      usage:            result.usage,
    });

  } catch (err: unknown) {
    const category = err instanceof ProviderError ? err.category : "unknown";
    console.error(`[ai:${requestId}] failed category=${category} ms=${Date.now() - startedAt}`);

    if (userId) {
      writeLog({
        toolNames: [], toolRounds: 0, inputTokens: 0, outputTokens: 0,
        success: false, errorCategory: category,
      });
    }

    return NextResponse.json(
      { error: "ai_unavailable", category, fallbackAllowed: cfg.mockFallback },
      { status: 503 }
    );
  }
}
