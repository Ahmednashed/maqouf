import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiAnswer } from "./types";
import type { EntityState } from "./entity-state";
import { clampStoredMessage, titleFromQuestion } from "./text-limits";

// ─────────────────────────────────────────────────────────────────────────────
// Conversation memory — server-side persistence through the AUTHENTICATED
// server client (RLS: user_id = auth.uid() AND own company). All functions
// degrade gracefully when migration 014 hasn't run yet (missing tables).
// ─────────────────────────────────────────────────────────────────────────────

function isMissingTable(error: { code?: string } | null): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

// Pure helpers (clampStoredMessage, titleFromQuestion) live in text-limits.ts
// so validation scenarios can import them without the server-only guard.

// ─── Persistence ──────────────────────────────────────────────────────────────
// Entity merging/rendering moved to entity-state.ts (v3 normalized state).

export interface ConversationRow {
  id:             string;
  entity_context: EntityState | null;
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
  entityContext: EntityState,
  findings?:    unknown
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

    const userRow = {
      ...base,
      role:    "user",
      content: clampStoredMessage(question),
    };
    const assistantRow = {
      ...base,
      role:          "assistant",
      content:       clampStoredMessage(answer.answer),
      tool_calls:    answer.toolCalls,
      sources:       answer.sources,
      input_tokens:  answer.usage?.inputTokens  ?? 0,
      output_tokens: answer.usage?.outputTokens ?? 0,
    };

    // findings column arrives with migration 016 — retry without it if absent
    const withFindings = findings !== undefined
      ? [userRow, { ...assistantRow, findings }]
      : [userRow, assistantRow];

    const { error: insertErr } = await supabase.from("ai_messages").insert(withFindings);
    if (insertErr && findings !== undefined) {
      await supabase.from("ai_messages").insert([userRow, assistantRow]);
    }

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
