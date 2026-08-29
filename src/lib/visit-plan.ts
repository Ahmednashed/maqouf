import type { FieldType, TemplateFieldFull } from "@/types";

// ─────────────────────────────────────────────────────────────────────────────
// What a visit was meant to cover, against what it actually recorded.
//
// The detail page could previously only show rows that already existed in
// visit_products. Those rows are seeded by initVisitProducts() at the moment a
// visit starts, so before that there are none at all — a planned visit showed
// nothing about what it was for, and a branch's required assortment stayed
// invisible until someone was standing in the shop.
//
// This derives the union of the two sides instead. It is pure, and both inputs
// are already fetched elsewhere (usePlaceProducts, useVisitProducts), so
// nothing here adds a query.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * "checked" is deliberately NOT "a visit_products row exists".
 *
 * initVisitProducts() writes one row per assortment product with qty_found
 * NULL, so row-existence would report a finished audit the moment a visit
 * started and nothing had been counted. A product is checked when a quantity
 * was actually recorded against it.
 */
export type ProductCheckState = "checked" | "expected" | "unexpected";

export interface PlannedProduct {
  product_id:       string;
  name_ar:          string;
  name_en:          string;
  sku:              string;
  unit:             string;
  is_mandatory:     boolean;
  min_stock:        number;
  display_priority: number;
  state:            ProductCheckState;
  qty_found:        number | null;
  qty_missing:      number | null;
  /** Recorded stock is under the branch minimum for this product. */
  below_min:        boolean;
  /**
   * A visit_products row exists for this product, counted or not.
   * Distinct from `state`: a seeded row is a record without a check. The
   * audit list renders exactly the rows that exist, so this is what tells a
   * summary which products that list is structurally unable to show.
   */
  has_record:       boolean;
}

export interface VisitProductPlan {
  products:              PlannedProduct[];
  expectedCount:         number;
  checkedCount:          number;
  mandatoryCount:        number;
  mandatoryCheckedCount: number;
  unexpectedCount:       number;
  belowMinCount:         number;
}

/** What this needs from a place_products row. */
export interface AssortmentRow {
  product_id:       string;
  is_mandatory:     boolean;
  min_stock:        number;
  display_priority: number;
  is_active:        boolean;
  product?: {
    name_ar: string;
    name_en: string;
    sku:     string;
    unit:    string;
  } | null;
}

/** What this needs from a visit_products row. */
export interface CheckRow {
  product_id:        string;
  qty_found:         number | null;
  qty_missing:       number | null;
  is_mandatory?:     boolean;
  min_stock?:        number;
  display_priority?: number;
  product?: {
    name_ar: string;
    name_en: string;
    sku:     string;
    unit:    string;
  } | null;
}

const BLANK = { name_ar: "", name_en: "", sku: "", unit: "" };

/**
 * Merge the branch assortment with whatever the visit recorded.
 *
 * Inactive assortment rows are dropped, matching initVisitProducts() — a
 * product withdrawn from the branch is not work anyone is expected to do.
 * A recorded check against such a product still surfaces, as "unexpected":
 * an assortment can change after a visit, and silently hiding a real
 * measurement because the plan moved on would lose data the shop produced.
 */
export function deriveVisitProductPlan(
  assortment: AssortmentRow[],
  checks:     CheckRow[],
): VisitProductPlan {
  const checkBy = new Map(checks.map((c) => [c.product_id, c]));
  const seen    = new Set<string>();
  const out: PlannedProduct[] = [];

  for (const a of assortment) {
    if (!a.is_active) continue;
    seen.add(a.product_id);
    const c    = checkBy.get(a.product_id);
    const qty  = c?.qty_found ?? null;
    const done = qty !== null;
    out.push({
      product_id:       a.product_id,
      ...BLANK,
      ...(a.product ?? c?.product ?? {}),
      is_mandatory:     a.is_mandatory,
      min_stock:        a.min_stock,
      display_priority: a.display_priority,
      state:            done ? "checked" : "expected",
      qty_found:        qty,
      qty_missing:      c?.qty_missing ?? null,
      below_min:        done && a.min_stock > 0 && qty < a.min_stock,
      has_record:       c !== undefined,
    });
  }

  for (const c of checks) {
    if (seen.has(c.product_id)) continue;
    const qty  = c.qty_found ?? null;
    const done = qty !== null;
    const min  = c.min_stock ?? 0;
    out.push({
      product_id:       c.product_id,
      ...BLANK,
      ...(c.product ?? {}),
      is_mandatory:     c.is_mandatory ?? false,
      min_stock:        min,
      display_priority: c.display_priority ?? 999,
      state:            "unexpected",
      qty_found:        qty,
      qty_missing:      c.qty_missing ?? null,
      below_min:        done && min > 0 && qty < min,
      has_record:       true,
    });
  }

  // The ordering fetchVisitProducts() already uses, so the two lists agree.
  out.sort((a, b) => {
    if (a.display_priority !== b.display_priority)
      return a.display_priority - b.display_priority;
    if (a.is_mandatory !== b.is_mandatory) return a.is_mandatory ? -1 : 1;
    return 0;
  });

  const expected = out.filter((p) => p.state !== "unexpected");
  return {
    products:              out,
    expectedCount:         expected.length,
    checkedCount:          expected.filter((p) => p.state === "checked").length,
    mandatoryCount:        expected.filter((p) => p.is_mandatory).length,
    mandatoryCheckedCount: expected.filter((p) => p.is_mandatory && p.state === "checked").length,
    unexpectedCount:       out.filter((p) => p.state === "unexpected").length,
    belowMinCount:         out.filter((p) => p.below_min).length,
  };
}

// ─── Template fields ──────────────────────────────────────────────────────────

/** "section" is a heading inside the form, not a question — never answered. */
export function isAnswerable(type: FieldType): boolean {
  return type !== "section";
}

export interface PlannedField {
  id:       string;
  label_ar: string;
  label_en: string;
  type:     FieldType;
  required: boolean;
  answered: boolean;
  value:    unknown;
}

export interface VisitFieldPlan {
  fields:                PlannedField[];
  answerableCount:       number;
  answeredCount:         number;
  requiredCount:         number;
  requiredAnsweredCount: number;
  missingRequired:       PlannedField[];
}

/**
 * Whether a stored response counts as an answer.
 *
 * Falsiness is not the test: `false` is a real answer to a yes/no field and
 * `0` is a real count. Only absence, an empty string and an empty list mean
 * nothing was recorded.
 */
export function isAnswered(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export function deriveVisitFieldPlan(
  fields:    TemplateFieldFull[],
  responses: Record<string, unknown>,
): VisitFieldPlan {
  const planned: PlannedField[] = [...fields]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((f) => {
      const value = responses[f.id];
      return {
        id:       f.id,
        label_ar: f.label_ar,
        label_en: f.label_en,
        type:     f.type,
        required: f.required,
        answered: isAnswerable(f.type) && isAnswered(value),
        value,
      };
    });

  const answerable = planned.filter((f) => isAnswerable(f.type));
  const required   = answerable.filter((f) => f.required);

  return {
    fields:                planned,
    answerableCount:       answerable.length,
    answeredCount:         answerable.filter((f) => f.answered).length,
    requiredCount:         required.length,
    requiredAnsweredCount: required.filter((f) => f.answered).length,
    missingRequired:       required.filter((f) => !f.answered),
  };
}
