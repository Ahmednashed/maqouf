// Test bootstrap. Loaded via `node --import ./tests/register.mjs --test`.
//
// Two jobs, both small:
//
//   1. Resolve the app's `@/*` path alias. Node runs the TypeScript in this
//      repo directly (type stripping, no build step and no dependency), but it
//      does not read tsconfig `paths`, so `@/lib/foo` has to be mapped here.
//
//   2. Redirect `@/lib/supabase/client` to a recording stub. This is deliberate
//      and structural: no test in this repo can reach a live database, because
//      the real client is never loaded. A service test drives the stub instead
//      of mocking per-file, which also avoids Node's experimental module-mock
//      flag.
//
// Extension resolution is explicit because `@/lib/foo` has no suffix and Node
// will not guess one for a file: URL.

import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

const ROOT = resolvePath(import.meta.dirname, "..");
const SRC = pathToFileURL(resolvePath(ROOT, "src") + "/").href;
const SUPABASE_STUB = pathToFileURL(
  resolvePath(ROOT, "tests", "stubs", "supabase-client.ts"),
).href;

/** Modules replaced for every test run, by alias specifier. */
const REDIRECTS = new Map([["@/lib/supabase/client", SUPABASE_STUB]]);

function withExtension(url) {
  const p = fileURLToPath(url);
  if (existsSync(p)) return url;
  for (const candidate of [p + ".ts", p + ".tsx", resolvePath(p, "index.ts")]) {
    if (existsSync(candidate)) return pathToFileURL(candidate).href;
  }
  return url;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const redirected = REDIRECTS.get(specifier);
    if (redirected) return nextResolve(redirected, context);
    if (specifier.startsWith("@/")) {
      return nextResolve(withExtension(new URL(specifier.slice(2), SRC).href), context);
    }
    return nextResolve(specifier, context);
  },
});
