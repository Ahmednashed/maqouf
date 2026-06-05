"use client";
import { useEffect } from "react";
import { useAppStore } from "@/store/app-store";
import { getDir } from "@/lib/utils/locale";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  const locale = useAppStore((s) => s.locale);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir  = getDir(locale);
  }, [locale]);

  return <>{children}</>;
}
