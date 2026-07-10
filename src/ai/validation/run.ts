/* eslint-disable no-console */
// Follow-up validation runner (Phase 6).
//   npx tsx src/ai/validation/run.ts
// Pure functions only — no network, no database, no API keys.

import { runAllScenarios } from "./scenarios";

const results = runAllScenarios();
let failed = 0;

for (const r of results) {
  const mark = r.passed ? "PASS" : "FAIL";
  if (!r.passed) failed++;
  console.log(`[${mark}] ${r.name} — ${r.detail}`);
}

console.log(`\n${results.length - failed}/${results.length} scenarios passed`);
process.exit(failed > 0 ? 1 : 0);
