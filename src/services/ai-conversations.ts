import { createClient } from "@/lib/supabase/client";
import type { ToolCallInfo } from "@/hooks/use-ai-operations";
import type { AiSource } from "@/ai/types";

// ─────────────────────────────────────────────────────────────────────────────
// AI conversation history — client reads via anon key + RLS
// (own conversations in own company only). Writes of messages happen
// server-side in /api/ai/chat; the client only renames and deletes.
// ─────────────────────────────────────────────────────────────────────────────

export interface AiConversationSummary {
  id:              string;
  title:           string;
  locale:          string;
  last_message_at: string;
  created_at:      string;
}

export interface StoredAiMessage {
  id:            string;
  role:          "user" | "assistant";
  content:       string;
  tool_calls:    ToolCallInfo[] | null;
  sources:       AiSource[] | null;
  created_at:    string;
}

function isMissingTable(error: { code?: string } | null): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

/** Recent conversations, newest activity first. [] pre-migration. */
export async function fetchConversations(limit = 20): Promise<AiConversationSummary[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("ai_conversations")
    .select("id, title, locale, last_message_at, created_at")
    .order("last_message_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  return (data ?? []) as AiConversationSummary[];
}

/** All messages of one conversation, oldest first. */
export async function fetchConversationMessages(
  conversationId: string
): Promise<StoredAiMessage[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("ai_messages")
    .select("id, role, content, tool_calls, sources, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  return (data ?? []) as StoredAiMessage[];
}

export async function renameConversation(id: string, title: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("ai_conversations")
    .update({ title: title.trim().slice(0, 60), updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/** Delete a conversation (messages cascade). */
export async function deleteConversation(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("ai_conversations")
    .delete()
    .eq("id", id);
  if (error) throw error;
}
