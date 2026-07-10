"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { useTranslation } from "@/hooks/use-translation";
import { useAiContext, useAiChat } from "@/hooks/use-ai-operations";
import { useConversationMessages } from "@/hooks/use-ai-conversations";
import { AiChatShell }        from "./_components/AiChatShell";
import { AiContextPanel }     from "./_components/AiContextPanel";
import { AiConversationList } from "./_components/AiConversationList";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function AiAssistantPage() {
  const { t, locale } = useTranslation();
  const context = useAiContext(todayIso());
  const chat    = useAiChat(context.data);

  // Conversation loading: pick id → fetch stored messages → hydrate chat
  const [pendingLoadId, setPendingLoadId] = useState<string | null>(null);
  const stored = useConversationMessages(pendingLoadId);

  useEffect(() => {
    if (pendingLoadId && stored.data) {
      chat.loadConversation(pendingLoadId, stored.data);
      setPendingLoadId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingLoadId, stored.data]);

  const dir = locale === "ar" ? "rtl" : "ltr";

  return (
    <div className="space-y-5 pb-6" dir={dir}>
      {/* Header */}
      <div>
        <h1 className="text-[22px] font-bold text-ink-900 flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white" />
          </span>
          {t("ai.pageTitle")}
        </h1>
        <p className="text-[13px] text-ink-400 mt-1">{t("ai.pageSubtitle")}</p>
      </div>

      {/* Chat (main) + side rail (conversations + context) */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
        <div className="xl:col-span-2 min-w-0">
          <AiChatShell context={context.data} chat={chat} />
        </div>
        <div className="min-w-0 space-y-5">
          <AiConversationList
            activeId={chat.conversationId}
            onNew={chat.clear}
            onOpen={(id) => setPendingLoadId(id)}
          />
          <AiContextPanel context={context.data} loading={context.isLoading} />
        </div>
      </div>
    </div>
  );
}
