"use client";

import { memo, useState } from "react";
import { MessagesSquare, Plus, Pencil, Trash2, Check, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/hooks/use-translation";
import {
  useAiConversations,
  useRenameConversation,
  useDeleteConversation,
} from "@/hooks/use-ai-conversations";
import { formatRelativeTime } from "@/lib/utils/format";
import type { Locale } from "@/types";

// ─── One row ──────────────────────────────────────────────────────────────────

interface RowProps {
  id:       string;
  title:    string;
  when:     string;
  active:   boolean;
  onOpen:   () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}

const ConversationRow = memo(function ConversationRow({
  title, when, active, onOpen, onRename, onDelete,
}: RowProps) {
  const { t }   = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(title);

  if (editing) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { onRename(draft); setEditing(false); }
            if (e.key === "Escape") setEditing(false);
          }}
          autoFocus
          className="flex-1 h-8 px-2 rounded-lg border border-violet-300 text-[12px] outline-none focus:ring-2 focus:ring-violet-100"
        />
        <button
          onClick={() => { onRename(draft); setEditing(false); }}
          aria-label={t("common.save")}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-emerald-500 hover:bg-emerald-50"
        >
          <Check className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => setEditing(false)}
          aria-label={t("common.cancel")}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-ink-400 hover:bg-ink-100"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group flex items-center gap-2 px-2.5 py-2 rounded-xl cursor-pointer transition-colors",
        active ? "bg-violet-50 border border-violet-100" : "hover:bg-ink-50"
      )}
      onClick={onOpen}
    >
      <MessagesSquare className={cn("w-3.5 h-3.5 shrink-0", active ? "text-violet-500" : "text-ink-300")} />
      <div className="flex-1 min-w-0">
        <p className={cn("text-[12px] font-semibold truncate", active ? "text-violet-700" : "text-ink-700")}>
          {title || t("ai.conv.untitled")}
        </p>
        <p className="text-[10px] text-ink-400">{when}</p>
      </div>
      <div
        className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => setEditing(true)}
          aria-label={t("ai.conv.rename")}
          title={t("ai.conv.rename")}
          className="w-6 h-6 rounded-md flex items-center justify-center text-ink-400 hover:text-brand-500 hover:bg-brand-50"
        >
          <Pencil className="w-3 h-3" />
        </button>
        <button
          onClick={onDelete}
          aria-label={t("ai.conv.delete")}
          title={t("ai.conv.delete")}
          className="w-6 h-6 rounded-md flex items-center justify-center text-ink-400 hover:text-rose-500 hover:bg-rose-50"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
});

// ─── List panel ───────────────────────────────────────────────────────────────

interface AiConversationListProps {
  activeId: string | null;
  onNew:    () => void;
  onOpen:   (id: string) => void;
}

export const AiConversationList = memo(function AiConversationList({
  activeId,
  onNew,
  onOpen,
}: AiConversationListProps) {
  const { t, locale } = useTranslation();
  const { data: conversations = [], isLoading } = useAiConversations();
  const rename = useRenameConversation();
  const remove = useDeleteConversation();

  return (
    <div className="bg-white rounded-2xl border border-ink-100 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-ink-100">
        <p className="text-[12.5px] font-bold text-ink-700">{t("ai.conv.title")}</p>
        <button
          onClick={onNew}
          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-violet-50 border border-violet-100 text-[11px] font-bold text-violet-600 hover:bg-violet-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 transition-all"
        >
          <Plus className="w-3 h-3" />
          {t("ai.conv.new")}
        </button>
      </div>

      <div className="p-2 max-h-[300px] overflow-y-auto">
        {isLoading ? (
          <div className="space-y-2 p-1">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-10 rounded-xl bg-ink-100 animate-pulse" />
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <p className="text-[11.5px] text-ink-300 text-center py-5">{t("ai.conv.empty")}</p>
        ) : (
          conversations.map((c) => (
            <ConversationRow
              key={c.id}
              id={c.id}
              title={c.title}
              when={formatRelativeTime(c.last_message_at, locale as Locale)}
              active={c.id === activeId}
              onOpen={() => onOpen(c.id)}
              onRename={(title) => title.trim() && rename.mutate({ id: c.id, title })}
              onDelete={() => {
                if (window.confirm(t("ai.conv.deleteConfirm"))) remove.mutate(c.id);
              }}
            />
          ))
        )}
      </div>
    </div>
  );
});
