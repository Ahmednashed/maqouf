"use client";

import { memo } from "react";
import { Map, MapPin, Smartphone } from "lucide-react";
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

      <div className="bg-white rounded-2xl border border-ink-100 shadow-sm p-4">
        <div className="flex items-center gap-4">
          {/* Mini illustration: stylised map tile */}
          <div className="relative w-20 h-20 rounded-2xl bg-gradient-to-br from-brand-50 to-blue-50 border border-brand-100 shrink-0 overflow-hidden">
            {/* Fake roads */}
            <div className="absolute top-1/2 start-0 end-0 h-px bg-brand-200/70 rotate-6" />
            <div className="absolute top-0 bottom-0 start-1/2 w-px bg-brand-200/70 -rotate-12" />
            <MapPin className="absolute top-3 start-4 w-3.5 h-3.5 text-brand-400" />
            <MapPin className="absolute bottom-4 end-3 w-3 h-3 text-emerald-400" />
            <span className="absolute bottom-2 start-3 w-1.5 h-1.5 rounded-full bg-amber-400" />
          </div>

          {/* Copy */}
          <div className="min-w-0">
            <p className="text-[13.5px] font-bold text-ink-800 leading-tight">
              {t("dashboard.map.noLocations")}
            </p>
            <p className="text-[12px] text-ink-400 leading-snug mt-1 flex items-start gap-1.5">
              <Smartphone className="w-3.5 h-3.5 shrink-0 mt-0.5 text-ink-300" />
              {t("dashboard.map.connectApp")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
});
