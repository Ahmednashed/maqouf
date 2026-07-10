import { MAX_STORED_MESSAGE_CHARS } from "./config";

// Pure text-shaping helpers shared by the (server-only) memory module and
// the validation scenarios. Kept free of "server-only" so tests can import.

/** Truncate a message before persisting it. */
export function clampStoredMessage(text: string, max = MAX_STORED_MESSAGE_CHARS): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

/** Conversation title from the first question. */
export function titleFromQuestion(question: string): string {
  const clean = question.trim().replace(/\s+/g, " ");
  return clean.length > 60 ? clean.slice(0, 57) + "…" : clean;
}
