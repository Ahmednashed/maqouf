import { daysSinceIso, type PlaceOps, type PlaceWithChain } from "@/services/places";
import type { ProductCoverage } from "@/services/products";
import type { Product, TemplateListItem } from "@/types";

// ─────────────────────────────────────────────────────────────────────────────
// Structural attention for the Command Center.
//
// deriveInsights() in lib/insights.ts already answers "how is TODAY going" —
// overdue visits, sync offenders, GPS check-ins, stock alerts. This answers the
// other half: what is set up wrong and will keep costing visits until someone
// fixes it. A branch nobody has ever been to, or a product no branch stocks,
// does not show up in any daily number — it just quietly never happens.
//
// Every item counts real rows. Nothing here is estimated, projected, or
// illustrative: this replaces a card that rendered invented statistics
// ("Riyadh completion dropped 12%", "Ahmed has only one visit today") beneath
// a real issue count, which made fabricated text read as measured fact.
// ─────────────────────────────────────────────────────────────────────────────

/** Days without a visit before a branch is worth surfacing. Matches the
 *  "gt14" bucket in the Branch Coverage report so the two never disagree. */
export const STALE_AFTER_DAYS = 14;

export type AttentionSeverity = "red" | "amber";

export interface AttentionItem {
  key:       string;
  severity:  AttentionSeverity;
  /** Translation key; {count} is substituted by the component. */
  msgKey:    string;
  count:     number;
  href:      string;
  actionKey: string;
}

export interface AttentionInput {
  places?:    PlaceWithChain[];
  placeOps?:  Record<string, PlaceOps>;
  products?:  Product[];
  coverage?:  Record<string, ProductCoverage>;
  templates?: TemplateListItem[];
  /** Riyadh business day, for staleness. */
  today:      string;
}

/**
 * Ranked, deduplicated attention items. Red = a branch or product cannot do its
 * job at all; amber = it works but is drifting.
 *
 * Only ACTIVE branches and products are considered — deactivating something is
 * a deliberate act, and nagging about it would train people to ignore the panel.
 */
export function deriveAttention(input: AttentionInput): AttentionItem[] {
  const { places = [], placeOps = {}, products = [], coverage = {}, templates = [], today } = input;

  const activePlaces = places.filter((p) => p.is_active);

  // ── Branches ──────────────────────────────────────────────────────────────
  const neverVisited = activePlaces.filter(
    (p) => !placeOps[p.id]?.last_visit_date
  ).length;

  // Stale excludes never-visited: they are already reported above, and counting
  // a branch twice inflates the panel rather than informing it.
  const stale = activePlaces.filter((p) => {
    const last = placeOps[p.id]?.last_visit_date;
    if (!last) return false;
    const days = daysSinceIso(last, today);
    return days !== null && days > STALE_AFTER_DAYS;
  }).length;

  const noAssortment = activePlaces.filter(
    (p) => (placeOps[p.id]?.product_count ?? 0) === 0
  ).length;

  const unassigned = activePlaces.filter((p) => !p.assigned_user_id).length;

  // ── Products ──────────────────────────────────────────────────────────────
  // A product no branch stocks will never be put in front of a merchandiser.
  //
  // Iterate the PRODUCTS, not the coverage map: fetchProductCoverage builds its
  // map from place_products rows, so a product assigned to no branch has no
  // entry there at all. Scanning the map would therefore find every orphan
  // except the ones that are actually orphaned.
  const orphanProducts = products.filter(
    (p) => p.is_active && (coverage[p.id]?.branch_count ?? 0) === 0
  ).length;

  // ── Templates ─────────────────────────────────────────────────────────────
  // Publishing an empty template is blocked now, so this only ever catches rows
  // that predate that guard — but those still fail silently in visit creation.
  const emptyPublished = templates.filter(
    (t) => t.status === "active" && t.field_count === 0
  ).length;

  return attentionItems({
    neverVisited, stale, noAssortment, unassigned, orphanProducts,
    emptyTemplate: emptyPublished,
  });
}

/**
 * The six counts, however they were obtained.
 *
 * Migration 025 computes exactly these in one call. Keeping them behind a named
 * shape means the ranking below has one definition rather than two, so a change
 * to severity or ordering cannot drift between the client-side derivation and
 * the database one.
 */
export interface AttentionCounts {
  neverVisited:   number;
  stale:          number;
  noAssortment:   number;
  unassigned:     number;
  orphanProducts: number;
  emptyTemplate:  number;
}

/**
 * Rank and shape the counts into panel items.
 *
 * Red first, then amber, and a zero count produces no item at all — an empty
 * list is what the panel reads as "nothing to set up", which is a different
 * statement from "we could not look". Whether the numbers came from five
 * queries or one is not this function's business.
 */
export function attentionItems(counts: AttentionCounts): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (counts.neverVisited > 0) items.push({
    key: "neverVisited", severity: "red", count: counts.neverVisited,
    msgKey: "dashboard.attn.neverVisited", href: "/places", actionKey: "dashboard.attn.openBranches",
  });

  if (counts.noAssortment > 0) items.push({
    key: "noAssortment", severity: "red", count: counts.noAssortment,
    msgKey: "dashboard.attn.noAssortment", href: "/place-products", actionKey: "dashboard.attn.openAssortment",
  });

  if (counts.emptyTemplate > 0) items.push({
    key: "emptyTemplate", severity: "red", count: counts.emptyTemplate,
    msgKey: "dashboard.attn.emptyTemplate", href: "/templates", actionKey: "dashboard.attn.openTemplates",
  });

  if (counts.stale > 0) items.push({
    key: "stale", severity: "amber", count: counts.stale,
    msgKey: "dashboard.attn.stale", href: "/places", actionKey: "dashboard.attn.openBranches",
  });

  if (counts.unassigned > 0) items.push({
    key: "unassigned", severity: "amber", count: counts.unassigned,
    msgKey: "dashboard.attn.unassigned", href: "/places", actionKey: "dashboard.attn.openBranches",
  });

  if (counts.orphanProducts > 0) items.push({
    key: "orphanProducts", severity: "amber", count: counts.orphanProducts,
    msgKey: "dashboard.attn.orphanProducts", href: "/products", actionKey: "dashboard.attn.openProducts",
  });

  return items;
}
