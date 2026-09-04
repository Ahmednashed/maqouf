import { eq, ok } from "./_harness.ts";
import { aPlace, anOps, aProduct, aTemplate } from "./fixtures.ts";
import { deriveAttention, STALE_AFTER_DAYS } from "@/lib/attention";
import type { AttentionItem } from "@/lib/attention";
import type { ProductCoverage } from "@/services/products";



const TODAY = "2026-08-30";

function countOf(items: AttentionItem[], key: string): number {
  return items.find((i) => i.key === key)?.count ?? 0;
}
function keys(items: AttentionItem[]): string[] { return items.map((i) => i.key); }

// ── 1. Empty / degenerate input ──────────────────────────────────────────────
eq("empty input yields no items", deriveAttention({ today: TODAY }), []);
eq("places present but nothing wrong yields no items",
   deriveAttention({
     places: [aPlace("p1")], placeOps: { p1: anOps() },
     products: [aProduct("x")], coverage: { x: { branch_count: 3, required_count: 1 } },
     templates: [aTemplate("t1", "active", 4)], today: TODAY,
   }), []);

// ── 2. neverVisited ──────────────────────────────────────────────────────────
{
  const items = deriveAttention({
    places: [aPlace("p1"), aPlace("p2")],
    placeOps: { p1: anOps({ last_visit_date: null }) },
    today: TODAY,
  });
  eq("neverVisited: null date and absent entry both count", countOf(items, "neverVisited"), 2);
  eq("neverVisited severity is red", items.find((i) => i.key === "neverVisited")?.severity, "red");
  eq("neverVisited href", items.find((i) => i.key === "neverVisited")?.href, "/places");
}
eq("neverVisited ignores inactive places",
   countOf(deriveAttention({
     places: [aPlace("p1", { is_active: false })], placeOps: {}, today: TODAY,
   }), "neverVisited"), 0);

// ── 3. stale, and its boundary ───────────────────────────────────────────────
eq("STALE_AFTER_DAYS is 14", STALE_AFTER_DAYS, 14);
{
  const at = (days: number) => {
    const d = new Date(Date.parse(TODAY + "T00:00:00Z") - days * 86_400_000);
    return d.toISOString().slice(0, 10);
  };
  eq("exactly 14 days is NOT stale",
     countOf(deriveAttention({
       places: [aPlace("p1")], placeOps: { p1: anOps({ last_visit_date: at(14) }) }, today: TODAY,
     }), "stale"), 0);
  eq("15 days IS stale",
     countOf(deriveAttention({
       places: [aPlace("p1")], placeOps: { p1: anOps({ last_visit_date: at(15) }) }, today: TODAY,
     }), "stale"), 1);
  eq("stale severity is amber",
     deriveAttention({
       places: [aPlace("p1")], placeOps: { p1: anOps({ last_visit_date: at(20) }) }, today: TODAY,
     }).find((i) => i.key === "stale")?.severity, "amber");
  eq("a future visit date is not stale",
     countOf(deriveAttention({
       places: [aPlace("p1")], placeOps: { p1: anOps({ last_visit_date: "2026-09-10" }) }, today: TODAY,
     }), "stale"), 0);
}
{
  const items = deriveAttention({
    places: [aPlace("p1"), aPlace("p2")],
    placeOps: { p1: anOps({ last_visit_date: null }), p2: anOps({ last_visit_date: "2026-01-01" }) },
    today: TODAY,
  });
  eq("never-visited is not double counted as stale", countOf(items, "stale"), 1);
  eq("never-visited counted once", countOf(items, "neverVisited"), 1);
}

// ── 4. noAssortment — absent entry must equal zero entry ─────────────────────
// This is the shape difference migration 024 introduces for products, and the
// one migration 022 already introduced for branches. Both must be inert.
{
  const absent = deriveAttention({ places: [aPlace("p1")], placeOps: {}, today: TODAY });
  const zero   = deriveAttention({
    places: [aPlace("p1")], placeOps: { p1: anOps({ last_visit_date: null, product_count: 0 }) },
    today: TODAY,
  });
  eq("noAssortment: absent ops entry counts as zero", countOf(absent, "noAssortment"), 1);
  eq("noAssortment: explicit zero counts too", countOf(zero, "noAssortment"), 1);
  eq("absent and explicit-zero produce identical keys", keys(absent), keys(zero));
}
eq("noAssortment ignores inactive places",
   countOf(deriveAttention({
     places: [aPlace("p1", { is_active: false })], placeOps: { p1: anOps({ product_count: 0 }) },
     today: TODAY,
   }), "noAssortment"), 0);

// ── 5. unassigned ────────────────────────────────────────────────────────────
eq("unassigned counts null assignee",
   countOf(deriveAttention({
     places: [aPlace("p1", { assigned_user_id: null }), aPlace("p2")],
     placeOps: { p1: anOps(), p2: anOps() }, today: TODAY,
   }), "unassigned"), 1);
eq("unassigned ignores inactive places",
   countOf(deriveAttention({
     places: [aPlace("p1", { is_active: false, assigned_user_id: null })],
     placeOps: { p1: anOps() }, today: TODAY,
   }), "unassigned"), 0);

// ── 6. orphanProducts — THE case migration 024 changes ───────────────────────
// Today an orphan has NO entry in the coverage map. The view gives it an entry
// holding zeros. Both must yield the same count, or the swap is not neutral.
{
  const mapAbsent: Record<string, ProductCoverage> = { b: { branch_count: 2, required_count: 0 } };
  const mapZero:   Record<string, ProductCoverage> = {
    a: { branch_count: 0, required_count: 0 },      // what v_product_coverage returns
    b: { branch_count: 2, required_count: 0 },
  };
  const products = [aProduct("a"), aProduct("b")];

  const withAbsent = deriveAttention({ products, coverage: mapAbsent, today: TODAY });
  const withZero   = deriveAttention({ products, coverage: mapZero,   today: TODAY });

  eq("orphan with absent coverage entry is counted", countOf(withAbsent, "orphanProducts"), 1);
  eq("orphan with zero coverage entry is counted",   countOf(withZero,   "orphanProducts"), 1);
  eq("absent-map and zero-map are indistinguishable", JSON.stringify(withAbsent), JSON.stringify(withZero));
}
eq("orphanProducts ignores inactive products",
   countOf(deriveAttention({
     products: [aProduct("a", { is_active: false })], coverage: {}, today: TODAY,
   }), "orphanProducts"), 0);
eq("a product carried by a branch is not an orphan",
   countOf(deriveAttention({
     products: [aProduct("a")], coverage: { a: { branch_count: 1, required_count: 0 } }, today: TODAY,
   }), "orphanProducts"), 0);
eq("orphanProducts severity is amber",
   deriveAttention({ products: [aProduct("a")], coverage: {}, today: TODAY })
     .find((i) => i.key === "orphanProducts")?.severity, "amber");

// ── 7. emptyPublished templates ──────────────────────────────────────────────
eq("active template with no fields counts",
   countOf(deriveAttention({ templates: [aTemplate("t1", "active", 0)], today: TODAY }), "emptyTemplate"), 1);
eq("draft template with no fields does not count",
   countOf(deriveAttention({ templates: [aTemplate("t1", "draft", 0)], today: TODAY }), "emptyTemplate"), 0);
eq("active template with fields does not count",
   countOf(deriveAttention({ templates: [aTemplate("t1", "active", 3)], today: TODAY }), "emptyTemplate"), 0);
eq("emptyTemplate severity is red",
   deriveAttention({ templates: [aTemplate("t1", "active", 0)], today: TODAY })
     .find((i) => i.key === "emptyTemplate")?.severity, "red");

// ── 8. Ordering and suppression ──────────────────────────────────────────────
{
  const items = deriveAttention({
    places: [
      aPlace("p1", { assigned_user_id: null }),          // never visited + unassigned + no assortment
      aPlace("p2"),                                       // stale
    ],
    placeOps: {
      p1: anOps({ last_visit_date: null, product_count: 0 }),
      p2: anOps({ last_visit_date: "2026-01-01" }),
    },
    products:  [aProduct("a")],
    coverage:  {},
    templates: [aTemplate("t1", "active", 0)],
    today: TODAY,
  });
  eq("all six items surface in red-then-amber order", keys(items),
     ["neverVisited", "noAssortment", "emptyTemplate", "stale", "unassigned", "orphanProducts"]);
  const sev = items.map((i) => i.severity);
  ok("no amber precedes a red", sev.indexOf("amber") > sev.lastIndexOf("red"), JSON.stringify(sev));
  eq("every item carries a nonzero count", items.every((i) => i.count > 0), true);
  eq("every item carries msgKey, href and actionKey",
     items.every((i) => !!i.msgKey && !!i.href && !!i.actionKey), true);
}

// ── 9. Undefined inputs stay honest (query failed -> undefined, not {}) ──────
{
  const items = deriveAttention({
    places: undefined, placeOps: undefined, products: undefined,
    coverage: undefined, templates: undefined, today: TODAY,
  });
  eq("all-undefined input yields no fabricated items", items, []);
}

