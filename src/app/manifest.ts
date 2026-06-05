import type { MetadataRoute } from "next";

/**
 * Web App Manifest — wired automatically by Next.js 14.
 * Served at /manifest.webmanifest.
 *
 * The manifest makes Malgoof installable as a standalone PWA on:
 *   – Android Chrome / Edge (via "Add to Home Screen")
 *   – Desktop Chrome / Edge (install icon in the address bar)
 *   – iOS Safari (via Share → "Add to Home Screen"; limited PWA support)
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name:             "Malgoof | ملقوف",
    short_name:       "Malgoof",
    description:
      "منصة إدارة الميرشندايزر الميدانية — نراقب الأداء، نحقق النتائج",
    start_url:        "/dashboard",
    scope:            "/",
    display:          "standalone",
    orientation:      "portrait",
    background_color: "#F9FAFB",
    theme_color:      "#111827",
    lang:             "ar",
    dir:              "rtl",
    categories:       ["business", "productivity"],
    icons: [
      {
        src:   "/icons/icon-192.png",
        sizes: "192x192",
        type:  "image/png",
      },
      {
        src:   "/icons/icon-512.png",
        sizes: "512x512",
        type:  "image/png",
      },
      {
        src:     "/icons/icon-maskable.png",
        sizes:   "512x512",
        type:    "image/png",
        // "maskable" tells Android to apply the adaptive-icon shape (circle,
        // squircle, etc.) — the brand color fills any safe-area clipping.
        purpose: "maskable",
      },
    ],
  };
}
