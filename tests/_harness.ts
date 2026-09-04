// Assertion helpers shared by the promoted test files.
//
// These were originally written as standalone scripts that printed PASS/FAIL
// and exited non-zero. Each helper now registers a real `node:test` case
// instead, so the runner reports and counts them individually. The call sites
// did not have to change, which is why the promoted tests read the same as the
// versions that originally found the bugs.
//
// Values are evaluated eagerly at call time, before the test body runs. That is
// fine — and intended — because everything under test here is a pure function
// over data the caller already built.

import { test } from "node:test";
import assert from "node:assert/strict";

/** Assert a condition. `got` is shown on failure. */
export function check(name: string, cond: boolean, got?: unknown): void {
  test(name, () => {
    assert.ok(cond, got === undefined ? name : `${name} — got ${JSON.stringify(got)}`);
  });
}

/** Assert deep equality. */
export function eq(name: string, actual: unknown, expected: unknown): void {
  test(name, () => {
    assert.deepStrictEqual(actual, expected);
  });
}

/** Assert a condition, with an optional detail string. */
export function ok(name: string, cond: boolean, detail?: string): void {
  test(name, () => {
    assert.ok(cond, detail ?? name);
  });
}
