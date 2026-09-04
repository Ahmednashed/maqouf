import { check } from "./_harness.ts";
import { diffVisitEdits, valuesEqual, type SavedProduct, type ProductEntry } from "@/lib/visit-dirty";


const p = (id: string, qty: number | null, notes: string | null = null): SavedProduct =>
  ({ product_id: id, qty_found: qty, notes });
const e = (qty: string, notes = ""): ProductEntry => ({ qty_found: qty, notes });

const base = {
  ready: true, savedProducts: [] as SavedProduct[], entries: {} as Record<string, ProductEntry>,
  fieldIds: [] as string[], savedResponses: {} as Record<string, unknown>,
  responses: {} as Record<string, unknown>,
};

console.log("1) freshly loaded data is NOT dirty");
{
  // The screen seeds "" for a null quantity; that must read as unchanged.
  const r = diffVisitEdits({ ...base,
    savedProducts: [p("a", null), p("b", 5, "note")],
    entries: { a: e(""), b: e("5", "note") } });
  check("no false positive on seeded state", r.dirty === false, r);
}

console.log("2) before the screen initialises, nothing is dirty");
{
  // entries {} against saved rows would otherwise look like edits everywhere.
  const r = diffVisitEdits({ ...base, ready: false,
    savedProducts: [p("a", 5)], entries: {} });
  check("ready:false short-circuits", r.dirty === false, r);
  const r2 = diffVisitEdits({ ...base, ready: true, savedProducts: [p("a", 5)], entries: {} });
  check("but ready:true does detect the gap", r2.dirty === true && r2.changedProducts === 1, r2);
}

console.log("3) a typed quantity is dirty");
{
  const r = diffVisitEdits({ ...base, savedProducts: [p("a", null)], entries: { a: e("3") } });
  check("dirty", r.dirty === true);
  check("counted once", r.changedProducts === 1, r.changedProducts);
}

console.log("4) typing zero is a real edit, not an empty one");
{
  const r = diffVisitEdits({ ...base, savedProducts: [p("a", null)], entries: { a: e("0") } });
  check('"0" differs from ""', r.dirty === true, r);
}

console.log("5) clearing a saved quantity is dirty");
{
  const r = diffVisitEdits({ ...base, savedProducts: [p("a", 4)], entries: { a: e("") } });
  check("dirty", r.dirty === true, r);
}

console.log("6) notes alone can be dirty");
{
  const r = diffVisitEdits({ ...base, savedProducts: [p("a", 2, "old")], entries: { a: e("2", "new") } });
  check("dirty on notes", r.dirty === true);
  const clean = diffVisitEdits({ ...base, savedProducts: [p("a", 2, "old")], entries: { a: e("2", "old") } });
  check("same notes are clean", clean.dirty === false);
}

console.log("7) null notes seed as empty string");
{
  const r = diffVisitEdits({ ...base, savedProducts: [p("a", 1, null)], entries: { a: e("1", "") } });
  check("null notes vs '' is clean", r.dirty === false, r);
}

console.log("8) responses: unchanged is clean");
{
  const r = diffVisitEdits({ ...base, fieldIds: ["q1"],
    savedResponses: { q1: "yes" }, responses: { q1: "yes" } });
  check("clean", r.dirty === false);
}

console.log("9) responses: an edit is dirty");
{
  const r = diffVisitEdits({ ...base, fieldIds: ["q1"],
    savedResponses: { q1: "yes" }, responses: { q1: "no" } });
  check("dirty", r.dirty === true);
  check("counted as a response change", r.changedResponses === 1, r.changedResponses);
}

console.log("10) a newly answered field is dirty");
{
  const r = diffVisitEdits({ ...base, fieldIds: ["q1"], savedResponses: {}, responses: { q1: false } });
  check("false is an answer, so this is an edit", r.dirty === true, r);
}

console.log("11) an untouched, never-answered field is clean");
{
  const r = diffVisitEdits({ ...base, fieldIds: ["q1"], savedResponses: {}, responses: {} });
  check("clean", r.dirty === false);
}

console.log("12) null and undefined both mean 'nothing recorded'");
{
  check("null vs undefined equal", valuesEqual(null, undefined) === true);
  const r = diffVisitEdits({ ...base, fieldIds: ["q1"],
    savedResponses: { q1: null }, responses: {} });
  check("saved null vs absent local is clean", r.dirty === false, r);
}

console.log("13) key order must not read as an edit");
{
  check("same object, different key order", valuesEqual({ a: 1, b: 2 }, { b: 2, a: 1 }) === true);
  const r = diffVisitEdits({ ...base, fieldIds: ["gps"],
    savedResponses: { gps: { latitude: 1, longitude: 2 } },
    responses:      { gps: { longitude: 2, latitude: 1 } } });
  check("no false positive from ordering", r.dirty === false, r);
}

console.log("14) arrays compare by order and length");
{
  check("equal arrays", valuesEqual(["a","b"], ["a","b"]) === true);
  check("different order is a change", valuesEqual(["a","b"], ["b","a"]) === false);
  check("different length is a change", valuesEqual(["a"], ["a","b"]) === false);
  check("empty arrays equal", valuesEqual([], []) === true);
  check("array vs object is not equal", valuesEqual([], {}) === false);
}

console.log("15) nested structures");
{
  check("deep equal", valuesEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }) === true);
  check("deep difference caught", valuesEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] }) === false);
  check("extra key caught", valuesEqual({ a: 1 }, { a: 1, b: 2 }) === false);
}

console.log("16) type changes are edits");
{
  check("string vs number", valuesEqual("1", 1) === false);
  check("false vs 0", valuesEqual(false, 0) === false);
  check("false vs null", valuesEqual(false, null) === false);
}

console.log("17) fields not in fieldIds are ignored");
{
  // Sections are filtered out by the caller and must never count as edits.
  const r = diffVisitEdits({ ...base, fieldIds: ["q1"],
    savedResponses: { q1: "a" }, responses: { q1: "a", section1: "junk" } });
  check("ignored", r.dirty === false, r);
}

console.log("18) both kinds at once");
{
  const r = diffVisitEdits({ ...base,
    savedProducts: [p("a", null), p("b", null)], entries: { a: e("1"), b: e("2") },
    fieldIds: ["q1"], savedResponses: {}, responses: { q1: "x" } });
  check("2 products + 1 response", r.changedProducts === 2 && r.changedResponses === 1, r);
  check("dirty", r.dirty === true);
}

console.log("19) nothing at all");
{
  check("empty is clean", diffVisitEdits({ ...base }).dirty === false);
}

console.log("20) typing into a never-answered field and clearing it is NOT dirty");
{
  // saveVisitResponses drops null/undefined, so an unanswered field has no
  // saved row. Local "" against saved undefined must not pin the visit dirty.
  const r = diffVisitEdits({ ...base, fieldIds: ["q1"], savedResponses: {}, responses: { q1: "" } });
  check("empty local vs absent saved is clean", r.dirty === false, r);
  const r2 = diffVisitEdits({ ...base, fieldIds: ["q1"], savedResponses: { q1: null }, responses: { q1: "   " } });
  check("whitespace vs null is clean", r2.dirty === false, r2);
  const r3 = diffVisitEdits({ ...base, fieldIds: ["q1"], savedResponses: {}, responses: { q1: [] } });
  check("empty array vs absent is clean", r3.dirty === false, r3);
}

console.log("21) but clearing a REAL saved answer is still dirty");
{
  const r = diffVisitEdits({ ...base, fieldIds: ["q1"], savedResponses: { q1: "abc" }, responses: { q1: "" } });
  check("answered -> empty is an edit", r.dirty === true, r);
  const r2 = diffVisitEdits({ ...base, fieldIds: ["q1"], savedResponses: { q1: ["a"] }, responses: { q1: [] } });
  check("list emptied is an edit", r2.dirty === true, r2);
}

console.log("22) blankness must not swallow real falsy answers");
{
  const r = diffVisitEdits({ ...base, fieldIds: ["q1"], savedResponses: {}, responses: { q1: false } });
  check("false is still an edit", r.dirty === true, r);
  const r2 = diffVisitEdits({ ...base, fieldIds: ["q1"], savedResponses: {}, responses: { q1: 0 } });
  check("0 is still an edit", r2.dirty === true, r2);
  const r3 = diffVisitEdits({ ...base, fieldIds: ["q1"], savedResponses: { q1: false }, responses: { q1: false } });
  check("unchanged false is clean", r3.dirty === false, r3);
}

console.log("23) nested empties are still real data");
{
  check('[""] differs from []', valuesEqual([""], []) === false);
  check('{a:""} differs from {}', valuesEqual({ a: "" }, {}) === false);
}

