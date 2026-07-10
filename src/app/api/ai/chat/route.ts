import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAiConfig, MAX_QUESTION_CHARS, MAX_HISTORY_MESSAGES } from "@/ai/config";
import { runOperationsChat } from "@/ai/router";
import { ProviderError } from "@/ai/types";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/chat — the only door between the browser and the AI Core.
//
// Security:
//  • Session verified via the cookie-based server client (401 otherwise).
//  • company_id is NEVER accepted from the client — RLS on the
//    authenticated client is the tenant boundary.
//  • Daily limit enforced server-side via SECURITY DEFINER RPC (429).
//  • OPENAI_API_KEY exists only in this server context.
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
  locale: z.enum(["ar", "en"]),
  date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8);
  const startedAt = Date.now();
  const cfg       = getAiConfig();

  try {
    // ── 1. Auth ──────────────────────────────────────────────────────────
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

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

    // The last message must be from the user (that's the question)
    if (messages[messages.length - 1].role !== "user") {
      return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }

    // ── 3. Daily rate limit (server-side, atomic) ────────────────────────
    const { data: countResult, error: rpcErr } = await supabase.rpc(
      "check_and_increment_ai_usage",
      { p_limit: cfg.dailyRequestLimit }
    );
    if (rpcErr) {
      // Pre-migration deployments: RPC missing → allow but log
      console.warn(`[ai:${requestId}] usage RPC unavailable: ${rpcErr.code}`);
    } else if (countResult === -1) {
      console.info(`[ai:${requestId}] user=${user.id} rate-limited`);
      return NextResponse.json(
        { error: "rate_limited" },
        { status: 429 }
      );
    }

    // ── 4. Run the AI Core ───────────────────────────────────────────────
    const result = await runOperationsChat({ supabase, messages, locale, date });

    // ── 5. Record token usage (best-effort, never blocks the response) ───
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

    // ── 6. Safe observability (no prompts, no keys, no row data) ─────────
    console.info(
      `[ai:${requestId}] user=${user.id} tools=[${result.toolCalls.map((c) => c.name).join(",")}] ` +
      `in=${result.usage?.inputTokens ?? 0} out=${result.usage?.outputTokens ?? 0} ` +
      `ms=${Date.now() - startedAt}`
    );

    return NextResponse.json(result);

  } catch (err: unknown) {
    const category = err instanceof ProviderError ? err.category : "unknown";
    console.error(`[ai:${requestId}] failed category=${category} ms=${Date.now() - startedAt}`);

    // Friendly, non-leaking error; tell the client if mock fallback is allowed
    return NextResponse.json(
      { error: "ai_unavailable", category, fallbackAllowed: cfg.mockFallback },
      { status: 503 }
    );
  }
}
