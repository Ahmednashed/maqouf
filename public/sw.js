/**
 * Malgoof Service Worker  (public/sw.js)
 *
 * Caching strategy
 * ────────────────
 * STATIC_CACHE   — immutable _next/static/* bundles + public icons/fonts
 *                  Strategy: cache-first (content-hashed filenames never collide)
 *
 * PAGE_CACHE     — navigated HTML pages
 *                  Strategy: network-first, cache as fallback when offline
 *
 * BYPASS         — Supabase API/realtime/storage, Next.js data routes,
 *                  any non-GET request
 *                  Strategy: always passthrough — never intercepted
 *
 * What is intentionally NOT cached
 * ─────────────────────────────────
 *   • *.supabase.co  — auth tokens, private data, realtime subscriptions
 *   • /_next/data/*  — Next.js RSC payloads (server-rendered, session-aware)
 *   • /api/*         — API routes (may be auth-gated)
 *   • POST/PATCH/DELETE/PUT — all mutations
 *
 * Offline data (visit drafts + photo queue) is handled separately by
 * localStorage (offline-drafts.ts) and IndexedDB (offline-photo-queue.ts).
 *
 * Future background sync
 * ──────────────────────
 * When Background Sync is added, this SW will register a sync tag
 * ('photo-queue-sync') and call the same IndexedDB helpers used by
 * use-offline-photo-queue.ts.  No schema changes will be needed.
 */

/* eslint-disable no-undef */

const CACHE_VERSION = "v1";
const STATIC_CACHE  = `malgoof-static-${CACHE_VERSION}`;
const PAGE_CACHE    = `malgoof-pages-${CACHE_VERSION}`;
const ALL_CACHES    = [STATIC_CACHE, PAGE_CACHE];

// ─── Patterns ─────────────────────────────────────────────────────────────────

/** Requests matching these patterns are NEVER cached. */
const BYPASS_PATTERNS = [
  /supabase\.co/,
  /supabase\.in/,
  /realtime/,
  /\/api\//,
  /\/_next\/data\//,     // Next.js server-side data payloads
  /chrome-extension/,
];

/** Static assets safe for aggressive cache-first caching. */
const STATIC_PATTERNS = [
  /\/_next\/static\//,   // JS/CSS bundles — content-hashed → immutable
  /\/icons\//,
  /\/fonts\//,
  /\/images\//,
  /\.woff2?(\?.*)?$/,
  /\.png(\?.*)?$/,
  /\.svg(\?.*)?$/,
  /\.ico(\?.*)?$/,
  /\.webp(\?.*)?$/,
];

// ─── Install ──────────────────────────────────────────────────────────────────

self.addEventListener("install", (event) => {
  // Take control immediately without waiting for existing clients to close.
  self.skipWaiting();

  // Pre-cache the PWA icons so they're available for the installed manifest.
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) =>
        cache
          .addAll([
            "/icons/icon-192.png",
            "/icons/icon-512.png",
            "/icons/icon-maskable.png",
            "/icons/apple-touch-icon.png",
          ])
          .catch(() => {
            // Silent fail — icons may temporarily not exist in dev builds.
          }),
      ),
  );
});

// ─── Activate ─────────────────────────────────────────────────────────────────

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      // Delete stale caches from previous SW versions.
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith("malgoof-") && !ALL_CACHES.includes(key),
            )
            .map((key) => caches.delete(key)),
        ),
      ),
      // Immediately claim all open clients so the new SW takes effect
      // without a page reload.
      self.clients.claim(),
    ]),
  );
});

// ─── Fetch ────────────────────────────────────────────────────────────────────

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only intercept GET requests.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Bypass — never intercept Supabase or API routes.
  if (BYPASS_PATTERNS.some((p) => p.test(url.href))) return;

  // ── Static assets: cache-first ─────────────────────────────────────────────
  // _next/static/* filenames contain content hashes → permanently immutable.
  // Public icons/fonts change rarely; serve from cache with background refresh.
  if (STATIC_PATTERNS.some((p) => p.test(url.href))) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // ── Navigation (HTML pages): network-first ─────────────────────────────────
  // Always try the network so the user sees the latest content.
  // Fall back to the cached version when offline.
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, PAGE_CACHE));
    return;
  }
  // All other requests (3rd-party, analytics, etc.) are passed through.
});

// ─── Strategy helpers ─────────────────────────────────────────────────────────

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      // clone() because the body can only be consumed once.
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    // Asset not available offline — browser will show its own error.
    return new Response("Asset not available offline", { status: 503 });
  }
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    // Network failed — try the cache.
    const cached = await caches.match(request);
    if (cached) return cached;

    // Last resort: serve the cached dashboard shell so the installed app
    // opens to something meaningful rather than a blank error page.
    const shell = await caches.match("/dashboard");
    if (shell) return shell;

    // Absolute fallback: minimal HTML so the browser doesn't show a dead tab.
    return new Response(
      `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head><meta charset="utf-8"><title>Malgoof — Offline</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font-family:system-ui,sans-serif;display:flex;align-items:center;
       justify-content:center;min-height:100vh;margin:0;background:#f9fafb;color:#111827}
  .card{text-align:center;padding:2rem;max-width:320px}
  .icon{font-size:3rem;margin-bottom:1rem}
  h1{font-size:1.25rem;font-weight:700;margin:0 0 .5rem}
  p{font-size:.875rem;color:#475569;margin:0}
</style>
</head>
<body>
<div class="card">
  <div class="icon">📡</div>
  <h1>غير متصل بالإنترنت</h1>
  <p>لا يمكن الوصول إلى الصفحة حالياً. تحقق من اتصالك بالإنترنت وأعد المحاولة.</p>
</div>
</body>
</html>`,
      {
        status:  503,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      },
    );
  }
}
