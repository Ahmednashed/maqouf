import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Malgoof / ملقوف",
  description: "Bilingual SaaS landing page for Malgoof field team management.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
