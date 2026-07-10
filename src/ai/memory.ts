import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiAnswer, EntityContext, ToolExecution } from "./types";
import { MAX_STORED_MESSAGE_CHARS } from "./config";

// ─────────────────────────────────────────────────────────────────────────────
// Conversation memory — server-side persistence through the AUTHENTICATED
// server client (RLS: user_id = auth.uid() AND own company). All functions
// degrade gracefully when migration 014 hasn't run yet (missing tables).
// ─────────────────────────────────────────────────────────────────────────────

function isMissingTable(error: { code?: string } | null): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

// ─── Pure helpers (exported for testing) ──────────────────────────────────────

/** Truncate a message before persisting it. */
export function clampStoredMessage(text: string, max = MAX_STORED_MESSAGE_CHARS): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

/** Conversation title from the first question. */
export function titleFromQuestion(question: string): string {
  const clean = question.trim().replace(/\s+/g, " ");
  return clean.length > 60 ? clean.slice(0, 57) + "…" : clean;
}

const CTX_CAP = 6;

/**
 * Merge entities observed in this turn's tool executions into the rolling
 * conversation context (most-recent-first, capped, deduped). Pure.
 */
export function mergeEntityContext(
  previous:   EntityContext | null | undefined,
  executions: ToolExecution[]
): EntityContext {
  const users:  string[] = [];
  const places: string[] = [];
  const visits: string[] = [];

  for (const ex of executions) {
    if (!ex.ok) continue;
    const d = ex.data as Record<string, unknown>;
    // Member names surfaced by user tools
    const memberName =
      (d.member as Record<string, unknown> | undefined)?.name ??
      (typeof d.member === "string" ? d.member : undefined);
    if (typeof memberName === "string") users.push(memberName);
    // Branch names surfaced by place tools
    if (typeof d.branch === "string") places.push(d.branch);
    // Visit ids from sources
    for (const s of ex.sources ?? []) {
      if (s.type === "visit")  visits.push(s.id);
      if (s.type === "user")   users.push(s.label);
      if (s.type === "place")  places.push(s.label);
    }
  }

  const merge = (fresh: string[], old: string[] = []) =>
    [...new Set([...fresh, ...old])].slice(0, CTX_CAP);

  return {
    users:     merge(users,  previous?.users),
    places:    merge(places, previous?.places),
    visit_ids: merge(visits, previous?.visit_ids),
  };
}

/** Render the entity context as a compact system-prompt line. */
export function renderEntityContext(ctx: EntityContext | null | undefined): string {
  if (!ctx) return "";
  const parts: string[] = [];
  if (ctx.users?.length)     parts.push(`people: ${ctx.users.join(", ")}`);
  if (ctx.places?.length)    parts.push(`branches: ${ctx.places.join(", ")}`);
  if (ctx.visit_ids?.length) parts.push(`visit_ids: ${ctx.visit_ids.slice(0, 3).join(", ")}`);
  return parts.length > 0 ? `Recently discussed in this conversation — ${parts.join(" | ")}` : "";
}

// ─── Persistence ──────────────────────────────────────────────────────────────

export interface ConversationRow {
  id:             string;
  entity_context: EntityContext | null;
}

/**
 * Load an existing conversation (RLS-verified ownership) or create one.
 * Returns null when the memory tables don't exist yet (pre-migration) —
 * the chat still works, it just doesn't persist.
 */
export async function loadOrCreateConversation(
  supabase:        SupabaseClient,
  conversationId:  string | undefined,
  firstQuestion:   string,
  locale:          string
): Promise<ConversationRow | null> {
  if (conversationId) {
    const { data, error } = await supabase
      .from("ai_conversations")
      .select("id, entity_context")
      .eq("id", conversationId)
      .maybeSingle();
    if (isMissingTable(error)) return null;
    if (data) return data as ConversationRow;
    // Unknown/foreign id → fall through and create a fresh conversation
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: membership } = await supabase
    .from("company_users")
    .select("company_id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!membership) return null;

  const { data, error } = await supabase
    .from("ai_conversations")
    .insert({
      company_id: membership.company_id,
      user_id:    user.id,
      title:      titleFromQuestion(firstQuestion),
      locale,
    })
    .select("id, entity_context")
    .single();

  if (error) return null;   // includes missing-table case
  return data as ConversationRow;
}

/** Persist the user question + assistant answer, update conversation state. */
export async function persistExchange(
  supabase:     SupabaseClient,
  conversation: ConversationRow,
  question:     string,
  answer:       AiAnswer,
  entityContext: EntityContext
): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: membership } = await supabase
      .from("company_users")
      .select("company_id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at")
      .limit(1)
      .maybeSingle();
    if (!membership) return;

    const base = {
      conversation_id: conversation.id,
      company_id:      membership.company_id,
      user_id:         user.id,
    };

    await supabase.from("ai_messages").insert([
      {
        ...base,
        role:    "user",
        content: clampStoredMessage(question),
      },
      {
        ...base,
        role:          "assistant",
        content:       clampStoredMessage(answer.answer),
        tool_calls:    answer.toolCalls,
        sources:       answer.sources,
        input_tokens:  answer.usage?.inputTokens  ?? 0,
        output_tokens: answer.usage?.outputTokens ?? 0,
      },
    ]);

    await supabase
      .from("ai_conversations")
      .update({
        last_message_at: new Date().toISOString(),
        updated_at:      new Date().toISOString(),
        entity_context:  entityContext,
      })
      .eq("id", conversation.id);
  } catch {
    // Persistence must never break the answer
  }
}
