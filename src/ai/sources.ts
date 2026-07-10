import type { AiSource } from "./types";
import { MAX_SOURCES } from "./config";

// ─────────────────────────────────────────────────────────────────────────────
// Structured sources — pure helpers (testable).
// Tools attach sources to their execution results; the router dedupes and
// caps them. Only entities with a safely resolvable page get an href.
// ─────────────────────────────────────────────────────────────────────────────

const HREF_BY_TYPE: Record<AiSource["type"], (id: string) => string | null> = {
  visit:    (id) => `/visits/${id}`,
  user:     ()   => "/users",
  place:    ()   => "/places",
  schedule: ()   => "/schedule",
  product:  ()   => "/products",
  activity: ()   => null,   // activity rows link via their target entity instead
};

/**
 * Build a source, returning null when the entity can't be safely resolved
 * to a page (per spec: don't show such sources).
 */
export function makeSource(
  type:      AiSource["type"],
  id:        string,
  label:     string,
  timestamp?: string
): AiSource | null {
  if (!id || !label?.trim()) return null;
  const href = HREF_BY_TYPE[type]?.(id);
  if (!href) return null;
  return { type, id, label: label.trim().slice(0, 80), href, timestamp };
}

/** Dedupe by (type,id), preserve first occurrence, cap at `max`. */
export function dedupeSources(
  sources: AiSource[],
  max = MAX_SOURCES
): AiSource[] {
  const seen = new Set<string>();
  const out: AiSource[] = [];
  for (const s of sources) {
    const key = `${s.type}:${s.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}
