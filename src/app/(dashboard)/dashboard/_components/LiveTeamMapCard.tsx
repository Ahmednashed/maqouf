"use client";

import { memo } from "react";
import Link from "next/link";
import { Map, MapPinOff, Smartphone, ArrowLeft } from "lucide-react";
import type { TranslationFn } from "@/hooks/use-translation";
import type { TranslationKey } from "@/lib/i18n/translations";
import { pluralKey } from "@/lib/i18n/plural";
import { DashboardSection, Card } from "./shared";

// ─────────────────────────────────────────────────────────────────────────────
// There is no live position feed yet, and this card says so.
//
// It used to say so in words while drawing a small map tile beside them:
// two crossing lines commented "Fake roads", two map pins, and a coloured
// dot — in the same emerald/amber the presence states use. A picture of pins
// on a map is read before the sentence denying it, so the card asserted
// exactly what its own text withdrew.
//
// A missing feed is not a reason to draw a fake one. What is left is the
// honest statement plus the one piece of location work that CAN be done from
// the web app today: branches are only checkable if they have coordinates.
// ─────────────────────────────────────────────────────────────────────────────

interface LiveTeamMapCardProps {
  t: TranslationFn;
  /** Branches with no lat/lng. Omitted while the query is still loading. */
  branchesWithoutCoords?: number;
  locale: string;
}

export const LiveTeamMapCard = memo(function LiveTeamMapCard({
  t, branchesWithoutCoords, locale,
}: LiveTeamMapCardProps) {
  const Arrow = locale === "ar" ? ArrowLeft : ArrowLeft;
  const gaps  = branchesWithoutCoords ?? 0;

  return (
    <DashboardSection title={t("dashboard.section.map")} icon={Map} fill>
      <Card fill className="flex items-center">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-2xl bg-ink-100 flex items-center justify-center shrink-0">
            <MapPinOff className="w-5 h-5 text-ink-400" />
          </div>

          <div className="min-w-0">
            <p className="text-[13.5px] font-bold text-ink-800 leading-tight">
              {t("dashboard.map.noLocations")}
            </p>
            <p className="text-[12px] text-ink-400 leading-snug mt-1 flex items-start gap-1.5">
              <Smartphone className="w-3.5 h-3.5 shrink-0 mt-0.5 text-ink-300" />
              {t("dashboard.map.connectApp")}
            </p>

            {/* The actionable half: a branch with no coordinates can never
                produce a verified check-in, and that is fixable from here. */}
            {gaps > 0 && (
              <Link
                href="/places"
                className="mt-2.5 inline-flex items-center gap-1.5 text-[12px] font-semibold text-brand-600 hover:text-brand-700 hover:underline"
              >
                <Arrow className="w-3.5 h-3.5 rtl:rotate-180" />
                {t(pluralKey("dashboard.map.fixCoords", gaps, locale) as TranslationKey)
                  .replace("{n}", String(gaps))}
              </Link>
            )}
          </div>
        </div>
      </Card>
    </DashboardSection>
  );
});
