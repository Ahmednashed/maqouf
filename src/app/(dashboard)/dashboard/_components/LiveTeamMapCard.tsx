"use client";

import { memo } from "react";
import { Map, MapPin } from "lucide-react";
import type { TranslationFn } from "@/hooks/use-translation";
import { SectionHeader } from "./shared";

// ─── Future contract ──────────────────────────────────────────────────────────
// When a map provider is integrated, positions plug straight into this prop —
// the card shell, header, and layout don't change.

export interface TeamPosition {
  memberId: string;
  name:     string;
  color:    string | null;
  lat:      number;
  lng:      number;
  updatedAt: string;
}

interface LiveTeamMapCardProps {
  t:          TranslationFn;
  positions?: TeamPosition[];   // unused until map integration lands
}

// ─── Placeholder component ────────────────────────────────────────────────────

export const LiveTeamMapCard = memo(function LiveTeamMapCard({ t }: LiveTeamMapCardProps) {
  return (
    <div>
      <SectionHeader title={t("dashboard.section.map")} icon={Map} />

      <div className="bg-white rounded-2xl border border-ink-100 shadow-sm overflow-hidden">
        <div className="relative h-[180px] bg-ink-50 flex flex-col items-center justify-center border-2 border-dashed border-ink-200 m-3 rounded-xl">
          {/* Decorative pins */}
          <MapPin className="absolute top-6 start-10 w-4 h-4 text-brand-300" />
          <MapPin className="absolute bottom-8 end-14 w-4 h-4 text-emerald-300" />
          <MapPin className="absolute top-12 end-24 w-3.5 h-3.5 text-amber-300" />

          <Map className="w-8 h-8 text-ink-300 mb-2" />
          <p className="text-[12px] text-ink-400 text-center px-8 leading-snug">
            {t("dashboard.map.comingSoon")}
          </p>
        </div>
      </div>
    </div>
  );
});
