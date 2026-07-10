"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  fetchConversations,
  fetchConversationMessages,
  renameConversation,
  deleteConversation,
  type AiConversationSummary,
  type StoredAiMessage,
} from "@/services/ai-conversations";
import { useTranslation } from "@/hooks/use-translation";

export const AI_CONVERSATIONS_KEY = ["ai-conversations"] as const;

export function useAiConversations() {
  return useQuery<AiConversationSummary[]>({
    queryKey:  AI_CONVERSATIONS_KEY,
    queryFn:   () => fetchConversations(),
    staleTime: 30_000,
  });
}

export function useConversationMessages(conversationId: string | null) {
  return useQuery<StoredAiMessage[]>({
    queryKey: ["ai-conversation-messages", conversationId],
    queryFn:  () => fetchConversationMessages(conversationId!),
    enabled:  Boolean(conversationId),
    staleTime: Infinity,   // messages are immutable; new ones come from ask()
  });
}

export function useRenameConversation() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      renameConversation(id, title),
    onSuccess: () => qc.invalidateQueries({ queryKey: AI_CONVERSATIONS_KEY }),
    onError:   () => toast.error(t("common.errorLoad")),
  });
}

export function useDeleteConversation() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: (id: string) => deleteConversation(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: AI_CONVERSATIONS_KEY }),
    onError:   () => toast.error(t("common.errorLoad")),
  });
}
