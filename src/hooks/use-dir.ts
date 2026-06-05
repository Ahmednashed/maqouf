"use client";
import { useAppStore } from "@/store/app-store";
import { getDir } from "@/lib/utils/locale";

export function useDir() {
  const locale = useAppStore((s) => s.locale);
  return getDir(locale);
}
