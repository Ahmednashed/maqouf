import { check } from "./_harness.ts";
import { deriveVisitReadiness, hasRequiredGaps } from "@/lib/visit-readiness";
import { deriveVisitProductPlan, deriveVisitFieldPlan, type AssortmentRow, type CheckRow } from "@/lib/visit-plan";
import type { TemplateFieldFull, FieldType } from "@/types";


const prod = (n: string) => ({ name_ar: n, name_en: n, sku: n, unit: "piece" });
const a = (id: string, o: Partial<AssortmentRow> = {}): AssortmentRow => ({
  product_id: id, is_mandatory: false, min_stock: 0, display_priority: 1,
  is_active: true, product: prod(id), ...o,
});
const c = (id: string, o: Partial<CheckRow> = {}): CheckRow => ({
  product_id: id, qty_found: null, qty_missing: null, product: prod(id), ...o,
});
const f = (id: string, type: FieldType, required = false, sort = 0): TemplateFieldFull => ({
  id, template_id: "t", company_id: "co", type, label_ar: id, label_en: id,
  required, sort_order: sort, options: null, help_text_ar: null, help_text_en: null,
  created_at: "", updated_at: "",
});
const COORDS = { lat: 24.7, lng: 46.7 };
interface GpsCols {
  checkin_verified: boolean | null;
  checkin_lat:      number | null;
  checkin_lng:      number | null;
}
const noGps: GpsCols = { checkin_verified: false, checkin_lat: null, checkin_lng: null };

function readiness(
  assortment: AssortmentRow[], checks: CheckRow[],
  fields: TemplateFieldFull[] | null, responses: Record<string, unknown>,
  place: { lat?: number | null; lng?: number | null } | null,
  gpsOverride?: Partial<GpsCols>,
) {
  return deriveVisitReadiness({
    productPlan: deriveVisitProductPlan(assortment, checks),
    fieldPlan:   fields ? deriveVisitFieldPlan(fields, responses) : null,
    visit:       { ...noGps, ...gpsOverride, place },
  });
}

console.log("1) the case the old modal got backwards");
{
  // Nothing counted at all. The old warning counted only quantities BELOW the
  // minimum, so it was zero here — silent when least work was done.
  const r = readiness([a("p1", { is_mandatory: true, min_stock: 5 }), a("p2")], [], null, {}, COORDS);
  check("belowMinCount is 0, as the old warning computed", r.belowMinCount === 0, r.belowMinCount);
  check("but the visit is NOT ready", r.ready === false);
  check("one required product outstanding", r.missingRequiredProducts === 1, r.missingRequiredProducts);
  check("two products unchecked overall", r.uncheckedProducts === 2, r.uncheckedProducts);
  check("hasRequiredGaps is true", hasRequiredGaps(r) === true);
}

console.log("2) a seeded row with no quantity is still outstanding");
{
  const r = readiness([a("p1", { is_mandatory: true })], [c("p1")], null, {}, COORDS);
  check("row exists yet still missing", r.missingRequiredProducts === 1, r.missingRequiredProducts);
  check("not ready", r.ready === false);
}

console.log("3) everything done");
{
  const r = readiness(
    [a("p1", { is_mandatory: true })], [c("p1", { qty_found: 4 })],
    [f("q1", "text", true)], { q1: "done" }, COORDS,
    { checkin_verified: true, checkin_lat: 24.7, checkin_lng: 46.7 },
  );
  check("ready", r.ready === true, r);
  check("no gaps", r.gaps.length === 0, r.gaps);
  check("gps verified", r.gps === "verified");
  check("hasRequiredGaps false", hasRequiredGaps(r) === false);
}

console.log("4) template fields are actually consulted");
{
  const r = readiness([], [], [f("q1", "text", true), f("q2", "yesno", true)], { q1: "x" }, COORDS);
  check("one required field missing", r.missingRequiredFields === 1, r.missingRequiredFields);
  check("not ready on fields alone", r.ready === false);
  check("gap listed", r.gaps.some(g => g.kind === "required_fields"));
}

console.log("5) a yes/no answered 'no' is answered");
{
  const r = readiness([], [], [f("q1", "yesno", true)], { q1: false }, COORDS);
  check("false counts as answered", r.missingRequiredFields === 0, r.missingRequiredFields);
  check("ready", r.ready === true);
}

console.log("6) GPS never blocks readiness");
{
  const r = readiness([a("p1")], [c("p1", { qty_found: 1 })], null, {}, COORDS);
  check("no position recorded", r.gps === "not_recorded", r.gps);
  check("but the visit is still ready", r.ready === true);
  check("the gap is reported anyway", r.gaps.some(g => g.kind === "gps_missing"));
  check("hasRequiredGaps stays false", hasRequiredGaps(r) === false);
}

console.log("7) a branch with no coordinates makes GPS not-applicable");
{
  const r = readiness([], [], null, {}, { lat: null, lng: null });
  check("not_applicable, not not_recorded", r.gps === "not_applicable", r.gps);
  check("no gps gap reported", !r.gaps.some(g => g.kind === "gps_missing"), r.gaps);
  const r2 = readiness([], [], null, {}, null);
  check("a missing place is also not_applicable", r2.gps === "not_applicable", r2.gps);
}

console.log("8) unchecked count does not double-report the required ones");
{
  // 3 expected, 2 mandatory, nothing checked.
  const r = readiness(
    [a("m1", { is_mandatory: true }), a("m2", { is_mandatory: true }), a("o1")], [],
    null, {}, COORDS,
  );
  check("2 required outstanding", r.missingRequiredProducts === 2, r.missingRequiredProducts);
  check("3 unchecked overall", r.uncheckedProducts === 3, r.uncheckedProducts);
  const extra = r.gaps.find(g => g.kind === "unchecked_products");
  check("the extra gap names only the 1 non-required", extra?.count === 1, extra);
}

console.log("9) required all done, optional outstanding");
{
  const r = readiness(
    [a("m1", { is_mandatory: true }), a("o1")], [c("m1", { qty_found: 2 })],
    null, {}, COORDS,
  );
  check("no required gap", hasRequiredGaps(r) === false);
  check("but not 'ready' — an expected product is unchecked", r.ready === false, r.ready);
  check("extra unchecked reported", r.gaps.some(g => g.kind === "unchecked_products"));
}

console.log("10) below-minimum is carried through, not conflated");
{
  const r = readiness(
    [a("p1", { is_mandatory: true, min_stock: 5 })], [c("p1", { qty_found: 2 })],
    null, {}, COORDS,
  );
  check("required work IS done", hasRequiredGaps(r) === false);
  check("ready", r.ready === true);
  check("shortfall still reported", r.belowMinCount === 1, r.belowMinCount);
}

console.log("11) no template, no assortment");
{
  const r = readiness([], [], null, {}, COORDS);
  check("ready with nothing to do", r.ready === true);
  check("only the gps gap", r.gaps.length === 1 && r.gaps[0].kind === "gps_missing", r.gaps);
}

console.log("12) gap ordering is stable and required-first");
{
  const r = readiness(
    [a("m1", { is_mandatory: true }), a("o1")], [],
    [f("q1", "text", true)], {}, COORDS,
  );
  check("fields, required products, unchecked, gps",
    r.gaps.map(g => g.kind).join() === "required_fields,required_products,unchecked_products,gps_missing",
    r.gaps.map(g => g.kind));
}

