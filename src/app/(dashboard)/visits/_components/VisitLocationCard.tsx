"use client";

import Link from "next/link";
import { MapPin, MapPinOff, ShieldCheck, ShieldAlert, Crosshair } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { TranslationFn } from "@/hooks/use-translation";
import { gpsCheckState, branchHasCoords, type GpsCheckSource } from "@/lib/gps-status";

// ─────────────────────────────────────────────────────────────────────────────
// What the check-in actually proves about where this visit happened.
//
// The page previously showed a single green "GPS verified" chip and nothing
// at all otherwise, so the two very different situations — a position was
// captured and validated, versus no position was ever captured — were
// indistinguishable from absence. Only the flattering one was ever named.
// ─────────────────────────────────────────────────────────────────────────────

export interface VisitLocationCardProps {
  visit: GpsCheckSource & {
    place?: { lat?: number | null; lng?: number | null } | null;
  };
  /** Nothing was captured before a visit starts, so the card stays hidden. */
  started: boolean;
  t:       TranslationFn;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-b border-ink-100 last:border-0">
      <span className="text-[12px] text-ink-400">{label}</span>
      <span className="text-[12.5px] font-semibold text-ink-800 font-mono" dir="ltr">{value}</span>
    </div>
  );
}

export function VisitLocationCard({ visit, started, t }: VisitLocationCardProps) {
  if (!started) return null;

  const state     = gpsCheckState(visit);
  const hasCoords = branchHasCoords(visit.place);
  const m = (n: number) => t("visits.loc.meters").replace("{n}", String(Math.round(n)));

  const tone = {
    verified:     { box: "border-emerald-200 bg-emerald-50/60", Icon: ShieldCheck, icon: "text-emerald-500", text: "text-emerald-800", label: t("visits.loc.verified") },
    outside:      { box: "border-rose-200 bg-rose-50/60",       Icon: ShieldAlert, icon: "text-rose-500",    text: "text-rose-800",    label: t("visits.loc.outside") },
    not_recorded: { box: "border-ink-200 bg-ink-50/60",         Icon: MapPinOff,   icon: "text-ink-400",     text: "text-ink-600",     label: t("visits.loc.notRecorded") },
  }[state];

  const { Icon } = tone;

  return (
    <section className={cn("rounded-2xl border mb-6 overflow-hidden", tone.box)}>
      <header className="px-5 py-3 flex items-center gap-2">
        <MapPin className="w-4 h-4 text-ink-400" />
        <h2 className="text-[13px] font-bold text-ink-700">{t("visits.loc.title")}</h2>
      </header>

      <div className="px-5 pb-4">
        <p className={cn("flex items-start gap-2 text-[13px] font-semibold", tone.text)}>
          <Icon className={cn("w-4 h-4 shrink-0 mt-0.5", tone.icon)} />
          {tone.label}
        </p>

        {state === "not_recorded" && (
          <>
            <p className="text-[12px] text-ink-400 mt-1.5 ms-6">{t("visits.loc.notRecordedHint")}</p>
            {/* Naming the cause matters: without branch coordinates no check-in
                could ever have verified, however the visit was carried out. */}
            {!hasCoords && (
              <div className="ms-6 mt-2">
                <p className="text-[12px] text-amber-700">{t("visits.loc.noBranchCoords")}</p>
                <Link
                  href="/places"
                  className="inline-flex items-center gap-1.5 mt-1 text-[12px] font-semibold text-brand-600 hover:text-brand-700 hover:underline"
                >
                  <Crosshair className="w-3.5 h-3.5" />
                  {t("visits.loc.addBranchCoords")}
                </Link>
              </div>
            )}
          </>
        )}

        {state !== "not_recorded" && (
          <div className="mt-3">
            {visit.checkin_distance_meters !== null && visit.checkin_distance_meters !== undefined && (
              <Row label={t("visits.loc.distance")} value={m(visit.checkin_distance_meters)} />
            )}
            {visit.checkin_accuracy !== null && visit.checkin_accuracy !== undefined && (
              <Row label={t("visits.loc.accuracy")} value={`± ${m(visit.checkin_accuracy)}`} />
            )}
            {visit.checkin_lat !== null && visit.checkin_lat !== undefined &&
             visit.checkin_lng !== null && visit.checkin_lng !== undefined && (
              <Row
                label={t("visits.loc.coords")}
                value={`${visit.checkin_lat.toFixed(5)}, ${visit.checkin_lng.toFixed(5)}`}
              />
            )}
          </div>
        )}
      </div>
    </section>
  );
}
