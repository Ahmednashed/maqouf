import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "تسجيل الدخول",
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-gradient-to-b from-ink-50 to-white flex items-center justify-center p-4">
      {children}
    </main>
  );
}
