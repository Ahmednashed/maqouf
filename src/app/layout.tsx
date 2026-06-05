import type { Metadata, Viewport } from "next";
import "./globals.css";

// ─── Metadata ─────────────────────────────────────────────────────────────────

export const metadata: Metadata = {
  title: {
    default:  "ملقوف | Malgoof",
    template: "%s | ملقوف",
  },
  description:
    "منصة إدارة الميرشندايزر الميدانية — نراقب الأداء، نحقق النتائج",
  keywords:  ["merchandiser", "ملقوف", "field operations", "SaaS"],
  authors:   [{ name: "Malgoof" }],
  robots:    "index, follow",

  // ── PWA / Apple meta ──────────────────────────────────────────────────────
  // apple-mobile-web-app-capable → enables standalone mode on iOS
  // apple-mobile-web-app-title   → name shown under the icon on the Home Screen
  appleWebApp: {
    capable:     true,
    title:       "Malgoof",
    statusBarStyle: "black-translucent",  // shows content behind the iOS status bar
  },

  // Manifest is auto-linked by Next.js from src/app/manifest.ts
  manifest: "/manifest.webmanifest",

  // Apple touch icon (iOS Home Screen icon — 180 × 180 PNG)
  icons: {
    apple: "/icons/apple-touch-icon.png",
    icon:  [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  },
};

// ─── Viewport ─────────────────────────────────────────────────────────────────

export const viewport: Viewport = {
  width:           "device-width",
  initialScale:    1,
  // viewportFit=cover lets content extend behind the iPhone notch / Dynamic
  // Island; we then use env(safe-area-inset-*) CSS vars to inset the UI.
  viewportFit:     "cover",
  themeColor: [
    // Separate entries for light/dark so the browser chrome always matches.
    { media: "(prefers-color-scheme: light)", color: "#111827" },
    { media: "(prefers-color-scheme: dark)",  color: "#111827" },
  ],
};

// ─── Root layout ──────────────────────────────────────────────────────────────

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // lang + dir are set dynamically by client components via <html> attributes.
  // Default to Arabic RTL for SSR.
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body className="min-h-screen bg-ink-50 antialiased">
        {children}
      </body>
    </html>
  );
}
