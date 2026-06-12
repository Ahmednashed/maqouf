import type { Locale } from "@/types";

// ─── Relative time ────────────────────────────────────────────────────────────

/**
 * Return a human-readable relative time string ("2 hours ago", "Yesterday", …).
 * Falls back to the date's locale string for anything older than 30 days.
 */
export function formatRelativeTime(
  dateStr: string | null | undefined,
  locale: Locale = "ar"
): string {
  if (!dateStr) return locale === "ar" ? "—" : "—";

  const date    = new Date(dateStr);
  const now     = new Date();
  const diffMs  = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffH   = Math.floor(diffMin / 60);
  const diffD   = Math.floor(diffH   / 24);
  const diffW   = Math.floor(diffD   / 7);

  if (diffMin  <  1) return locale === "ar" ? "الآن"            : "Just now";
  if (diffMin  < 60) return locale === "ar" ? `منذ ${diffMin} د` : `${diffMin}m ago`;
  if (diffH    < 24) return locale === "ar" ? `منذ ${diffH} س`   : `${diffH}h ago`;
  if (diffD   ===  1) return locale === "ar" ? "أمس"             : "Yesterday";
  if (diffD    <  7) return locale === "ar" ? `منذ ${diffD} أيام` : `${diffD}d ago`;
  if (diffW    <  5) return locale === "ar" ? `منذ ${diffW} أسابيع` : `${diffW}w ago`;

  return date.toLocaleDateString(locale === "ar" ? "ar-SA-u-ca-gregory" : "en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

export function formatDate(date: string | Date, locale: Locale): string {
  return new Date(date).toLocaleDateString(
    locale === "ar" ? "ar-SA-u-ca-gregory" : "en-GB",
    { day: "2-digit", month: "short", year: "numeric" }
  );
}

export function formatNumber(n: number, locale: Locale): string {
  return n.toLocaleString(locale === "ar" ? "ar-SA" : "en-US");
}

export function formatCurrency(amount: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === "ar" ? "ar-SA" : "en-US", {
    style: "decimal",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount) + (locale === "ar" ? " ر.س" : " SAR");
}
