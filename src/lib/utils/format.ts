import type { Locale } from "@/types";

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
