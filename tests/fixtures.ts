// Fixture factories for the domain types the tests need.
//
// These build COMPLETE, type-valid objects and let a test override only the
// fields it cares about. That is deliberately more verbose than casting a
// partial object: the tests are checked against the real `Place`, `Product` and
// `TemplateListItem`, so a change to any of those shapes surfaces here rather
// than being silently absorbed by an `as unknown as`.

import type { Place, Product, TemplateListItem } from "@/types";
import type { PlaceWithChain, PlaceOps } from "@/services/places";

const COMPANY = "co-1";
const NOW = "2026-08-29T00:00:00Z";

export function aPlace(id: string, over: Partial<Place> = {}): PlaceWithChain {
  return {
    id,
    company_id:       COMPANY,
    chain_id:         "chain-1",
    branch_ar:        "فرع",
    branch_en:        "Branch",
    code:             id.toUpperCase(),
    assigned_user_id: "u1",
    is_active:        true,
    created_at:       NOW,
    updated_at:       NOW,
    ...over,
  };
}

export function anOps(over: Partial<PlaceOps> = {}): PlaceOps {
  return {
    last_visit_date:   "2026-08-29",
    last_visit_status: "completed",
    last_visit_merch:  "u1",
    product_count:     5,
    required_count:    2,
    ...over,
  };
}

export function aProduct(id: string, over: Partial<Product> = {}): Product {
  return {
    id,
    company_id: COMPANY,
    sku:        id.toUpperCase(),
    name_ar:    "منتج",
    name_en:    "Product",
    category:   "snacks",
    unit:       "piece",
    stock:      0,
    is_active:  true,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  };
}

export function aTemplate(
  id: string,
  status: "active" | "draft",
  field_count: number,
): TemplateListItem {
  return {
    id,
    company_id:  COMPANY,
    name_ar:     "قالب",
    name_en:     "Template",
    status,
    usage_count: 0,
    created_by:  "u1",
    created_at:  NOW,
    updated_at:  NOW,
    field_count,
  };
}
