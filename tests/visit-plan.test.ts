import { check } from "./_harness.ts";
import {
  deriveVisitProductPlan,
  deriveVisitFieldPlan,
  isAnswered,
  type AssortmentRow,
  type CheckRow,
} from "@/lib/visit-plan";
import type { TemplateFieldFull, FieldType } from "@/types";


const prod = (n: string) => ({ name_ar: n, name_en: n, sku: n.toUpperCase(), unit: "piece" });
const a = (id: string, o: Partial<AssortmentRow> = {}): AssortmentRow => ({
  product_id: id, is_mandatory: false, min_stock: 0, display_priority: 1,
  is_active: true, product: prod(id), ...o,
});
const c = (id: string, o: Partial<CheckRow> = {}): CheckRow => ({
  product_id: id, qty_found: null, qty_missing: null, product: prod(id), ...o,
});

console.log("1) a seeded-but-uncounted row is NOT a completed check");
{
  // initVisitProducts writes rows with qty_found NULL the moment a visit starts.
  const p = deriveVisitProductPlan([a("p1"), a("p2")], [c("p1"), c("p2")]);
  check("both rows exist yet checked = 0", p.checkedCount === 0, p.checkedCount);
  check("both report as expected", p.products.every(x => x.state === "expected"));
  check("expectedCount = 2", p.expectedCount === 2, p.expectedCount);
}

console.log("2) zero is a real count, not an absence");
{
  const p = deriveVisitProductPlan([a("p1", { min_stock: 3 })], [c("p1", { qty_found: 0 })]);
  check("qty_found 0 counts as checked", p.checkedCount === 1, p.checkedCount);
  check("0 below a minimum of 3 flags below_min", p.products[0].below_min === true);
  check("belowMinCount = 1", p.belowMinCount === 1);
}

console.log("3) min_stock 0 never flags below_min");
{
  const p = deriveVisitProductPlan([a("p1", { min_stock: 0 })], [c("p1", { qty_found: 0 })]);
  check("no minimum set means no shortfall", p.products[0].below_min === false);
  check("belowMinCount = 0", p.belowMinCount === 0);
}

console.log("4) a pending visit: assortment with no checks at all");
{
  const p = deriveVisitProductPlan([a("p1", { is_mandatory: true }), a("p2")], []);
  check("all expected products still listed", p.products.length === 2, p.products.length);
  check("checked = 0", p.checkedCount === 0);
  check("mandatoryCount = 1", p.mandatoryCount === 1, p.mandatoryCount);
  check("mandatoryChecked = 0", p.mandatoryCheckedCount === 0);
}

console.log("5) inactive assortment rows are dropped, but their data survives");
{
  const p = deriveVisitProductPlan(
    [a("p1", { is_active: false })],
    [c("p1", { qty_found: 5 })],
  );
  check("inactive product is not 'expected'", p.expectedCount === 0, p.expectedCount);
  check("its real measurement still shows as unexpected", p.unexpectedCount === 1, p.unexpectedCount);
  check("the recorded quantity is preserved", p.products[0].qty_found === 5);
}

console.log("6) a check against a product never in the assortment");
{
  const p = deriveVisitProductPlan([a("p1")], [c("p9", { qty_found: 2 })]);
  check("assortment product listed as expected", p.products.some(x => x.product_id === "p1" && x.state === "expected"));
  check("stray check listed as unexpected", p.products.some(x => x.product_id === "p9" && x.state === "unexpected"));
  check("unexpected excluded from expectedCount", p.expectedCount === 1, p.expectedCount);
  check("unexpected excluded from checkedCount", p.checkedCount === 0, p.checkedCount);
}

console.log("7) ordering: priority, then mandatory first");
{
  const p = deriveVisitProductPlan([
    a("low",  { display_priority: 2 }),
    a("norm", { display_priority: 1, is_mandatory: false }),
    a("must", { display_priority: 1, is_mandatory: true }),
  ], []);
  check("mandatory floats above peer at same priority",
    p.products.map(x => x.product_id).join(",") === "must,norm,low",
    p.products.map(x => x.product_id));
}

console.log("8) product names come from whichever side has them");
{
  const p = deriveVisitProductPlan([a("p1", { product: null })], [c("p1", { qty_found: 1 })]);
  check("falls back to the check row's product", p.products[0].name_ar === "p1", p.products[0].name_ar);
  const q = deriveVisitProductPlan([a("p2", { product: null })], []);
  check("missing on both sides yields empty, not undefined", q.products[0].name_ar === "", q.products[0].name_ar);
}

console.log("9) empty everything");
{
  const p = deriveVisitProductPlan([], []);
  check("no throw, all zero", p.products.length === 0 && p.expectedCount === 0 && p.checkedCount === 0);
}

// ── Template fields ──────────────────────────────────────────────────────────
const f = (id: string, type: FieldType, required = false, sort = 0): TemplateFieldFull => ({
  id, template_id: "t", company_id: "co", type, label_ar: id, label_en: id,
  required, sort_order: sort, options: null, help_text_ar: null, help_text_en: null,
  created_at: "", updated_at: "",
});

console.log("10) false and 0 are answers");
{
  check("false is answered", isAnswered(false) === true);
  check("0 is answered", isAnswered(0) === true);
  check("empty string is not", isAnswered("") === false);
  check("whitespace is not", isAnswered("   ") === false);
  check("empty array is not", isAnswered([]) === false);
  check("null is not", isAnswered(null) === false);
  check("undefined is not", isAnswered(undefined) === false);
  check("non-empty array is", isAnswered(["a"]) === true);
}

console.log("11) a yes/no answered 'no' counts as answered");
{
  const p = deriveVisitFieldPlan([f("q1", "yesno", true)], { q1: false });
  check("answered = 1", p.answeredCount === 1, p.answeredCount);
  check("no missing required", p.missingRequired.length === 0, p.missingRequired.map(x => x.id));
}

console.log("12) section headings are never counted as questions");
{
  const p = deriveVisitFieldPlan(
    [f("s1", "section", true, 0), f("q1", "text", true, 1)],
    { q1: "done" },
  );
  check("answerableCount excludes the section", p.answerableCount === 1, p.answerableCount);
  check("requiredCount excludes the section", p.requiredCount === 1, p.requiredCount);
  check("all required satisfied", p.missingRequired.length === 0, p.missingRequired.map(x => x.id));
  check("the section is still rendered in fields", p.fields.length === 2);
}

console.log("13) unanswered required fields are reported");
{
  const p = deriveVisitFieldPlan(
    [f("q1", "text", true, 0), f("q2", "numeric", true, 1), f("q3", "text", false, 2)],
    { q1: "yes" },
  );
  check("requiredCount = 2", p.requiredCount === 2, p.requiredCount);
  check("requiredAnswered = 1", p.requiredAnsweredCount === 1, p.requiredAnsweredCount);
  check("missingRequired names q2", p.missingRequired.map(x => x.id).join() === "q2", p.missingRequired.map(x => x.id));
  check("optional unanswered not reported as missing", !p.missingRequired.some(x => x.id === "q3"));
}

console.log("14) fields render in sort_order regardless of input order");
{
  const p = deriveVisitFieldPlan([f("b", "text", false, 2), f("a", "text", false, 1)], {});
  check("sorted by sort_order", p.fields.map(x => x.id).join() === "a,b", p.fields.map(x => x.id));
}

console.log("15) no template fields at all");
{
  const p = deriveVisitFieldPlan([], {});
  check("no throw, all zero", p.fields.length === 0 && p.answerableCount === 0 && p.missingRequired.length === 0);
}

console.log("16) has_record separates a seeded row from no row at all");
{
  const p = deriveVisitProductPlan([a("seeded"), a("fresh")], [c("seeded")]);
  const seeded = p.products.find(x => x.product_id === "seeded")!;
  const fresh  = p.products.find(x => x.product_id === "fresh")!;
  check("seeded row has a record", seeded.has_record === true);
  check("but is still not checked", seeded.state === "expected");
  check("product with no row has no record", fresh.has_record === false);
  check("only the recordless one is invisible to the audit list",
    p.products.filter(x => !x.has_record).map(x => x.product_id).join() === "fresh",
    p.products.filter(x => !x.has_record).map(x => x.product_id));
}

console.log("17) an unexpected check always has a record");
{
  const p = deriveVisitProductPlan([], [c("stray", { qty_found: 1 })]);
  check("unexpected implies has_record", p.products[0].has_record === true);
}

