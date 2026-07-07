"use client";

import { Sparkles } from "lucide-react";
import { useTranslation } from "@/hooks/use-translation";
import { useAiContext } from "@/hooks/use-ai-operations";
import { AiChatShell }    from "./_components/AiChatShell";
import { AiContextPanel } from "./_components/AiContextPanel";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function AiAssistantPage() {
  const { t, locale } = useTranslation();
  const context = useAiContext(todayIso());

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

      {/* Chat (main) + context panel (side) */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
        <div className="xl:col-span-2 min-w-0">
          <AiChatShell context={context.data} />
        </div>
        <div className="min-w-0">
          <AiContextPanel context={context.data} loading={context.isLoading} />
        </div>
      </div>
    </div>
  );
}
