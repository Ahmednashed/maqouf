"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowLeft, ArrowRight,
  MapPin, User, Clock, CalendarDays, Package,
  AlertTriangle, CheckCircle2, XCircle, Play,
  Save, CheckSquare, AlertCircle, Minus, Plus, FileText,
  WifiOff, RotateCcw, CloudUpload, ShieldCheck, History,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useTranslation, type TranslationFn } from "@/hooks/use-translation";
import {
  useVisit,
  useStartVisit,
  useMarkMissed,
  type StartVisitPayload,
} from "@/hooks/use-visits";
import {
  getCurrentPosition,
  haversineDistance,
  DEFAULT_CHECKIN_RADIUS_METERS,
  ACCURACY_WARNING_THRESHOLD_METERS,
  type GpsPosition,
} from "@/lib/geo";
import { useVisitProducts, useSaveVisitProducts } from "@/hooks/use-visit-products";
import { useVisitResponses, useSaveVisitResponses } from "@/hooks/use-visit-responses";
import { useTemplate } from "@/hooks/use-templates";
import type { VisitProductWithDetails } from "@/services/visit-products";
import type { VisitWithDetails } from "@/services/visits";
import { CompleteModal } from "../_components/CompleteModal";
import {
  TemplateFieldSection,
  type FieldResponses,
} from "../_components/TemplateFieldSection";
import {
  useOfflineVisitDraft,
  type SyncStatus,
} from "@/hooks/use-offline-visit-draft";
import type { DraftProducts } from "@/lib/offline-drafts";
import { useEntityActivity } from "@/hooks/use-activity-logs";
import { ActivityTimeline } from "@/components/activity/ActivityTimeline";

// ─── Types ────────────────────────────────────────────────────────────────────

type ProductEntry = { qty_found: string; notes: string };
type Entries      = Record<string, ProductEntry>;

// ─── Elapsed timer hook ───────────────────────────────────────────────────────

function useElapsedTimer(startedAt: string | null | undefined): string {
  const [elapsed, setElapsed] = useState("");

  useEffect(() => {
    if (!startedAt) { setElapsed(""); return; }

    const tick = () => {
      const diffMs   = Date.now() - new Date(startedAt).getTime();
      const totalSec = Math.max(0, Math.floor(diffMs / 1000));
      const h  = Math.floor(totalSec / 3600);
      const m  = Math.floor((totalSec % 3600) / 60);
      const s  = totalSec % 60;
      setElapsed(
        h > 0
          ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
          : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      );
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  return elapsed;
}

// ─── Sync status pill ─────────────────────────────────────────────────────────
//
// Shown inside the sticky action bar to communicate draft / sync state.

function SyncStatusPill({
  status, isOnline, t,
}: {
  status:   SyncStatus;
  isOnline: boolean;
  t:        TranslationFn;
}) {
  if (status === "idle") return null;

  const cfg: Record<Exclude<SyncStatus, "idle">, { label: string; dot: string; color: string }> = {
    unsaved: {
      label: t("offline.unsaved"),
      dot:   "bg-amber-400",
      color: "text-amber-700",
    },
    draft: {
      label: isOnline ? t("offline.draftSaved") : t("offline.savedOffline"),
      dot:   "bg-blue-400",
      color: "text-blue-700",
    },
    saving: {
      label: t("offline.syncing"),
      dot:   "bg-brand-500 animate-pulse",
      color: "text-brand-700",
    },
    synced: {
      label: t("offline.synced"),
      dot:   "bg-emerald-500",
      color: "text-emerald-700",
    },
    failed: {
      label: t("offline.syncFailed"),
      dot:   "bg-rose-500",
      color: "text-rose-700",
    },
  };

  const c = cfg[status as Exclude<SyncStatus, "idle">];
  if (!c) return null;

  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[11.5px] font-semibold", c.color)}>
      <span className={cn("w-2 h-2 rounded-full shrink-0", c.dot)} />
      {c.label}
    </span>
  );
}

// ─── Restore prompt banner ────────────────────────────────────────────────────

function RestorePromptBanner({
  savedAt, locale, t, onRestore, onDiscard,
}: {
  savedAt:   string;
  locale:    string;
  t:         TranslationFn;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  const formattedTime = new Date(savedAt).toLocaleString(
    locale === "ar" ? "ar-SA" : "en-GB",
    { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }
  );

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 mb-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
          <RotateCcw className="w-4.5 h-4.5 text-blue-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13.5px] font-bold text-blue-800">{t("offline.draftFound")}</p>
          <p className="text-[12px] text-blue-600 mt-0.5">
            {t("offline.draftSavedAt").replace("{time}", formattedTime)}
          </p>
        </div>
      </div>
      <div className="flex gap-2 mt-3">
        <button
          onClick={onRestore}
          className="flex-1 h-9 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold transition-all"
        >
          {t("offline.restore")}
        </button>
        <button
          onClick={onDiscard}
          className="flex-1 h-9 rounded-xl border border-blue-200 text-blue-700 text-[13px] font-semibold hover:bg-blue-100 transition-all"
        >
          {t("offline.discard")}
        </button>
      </div>
    </div>
  );
}

// ─── Product audit card ───────────────────────────────────────────────────────

interface ProductCardProps {
  item:     VisitProductWithDetails;
  entry:    ProductEntry;
  readOnly: boolean;
  locale:   string;
  t:        TranslationFn;
  onChange: (productId: string, field: keyof ProductEntry, value: string) => void;
}

function ProductCard({ item, entry, readOnly, locale, t, onChange }: ProductCardProps) {
  const name       = locale === "ar" ? item.product.name_ar : item.product.name_en;
  const qtyFound   = parseInt(entry.qty_found) || 0;
  const qtyMissing = Math.max(0, item.min_stock - qtyFound);
  const hasValue   = entry.qty_found !== "";
  const isBelowMin = hasValue && qtyFound < item.min_stock;
  const isOk       = hasValue && qtyFound >= item.min_stock;
  const isEmpty    = hasValue && qtyFound === 0;

  const cardBorder = cn(
    "rounded-2xl border-2 transition-all overflow-hidden",
    !hasValue  ? "border-ink-100 bg-white" :
    isEmpty    ? "border-rose-200 bg-rose-50/30" :
    isBelowMin ? "border-amber-200 bg-amber-50/20" :
                 "border-emerald-200 bg-emerald-50/20"
  );

  return (
    <div className={cardBorder}>
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              {item.is_mandatory && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-50 text-rose-600 text-[10.5px] font-bold border border-rose-200">
                  <AlertTriangle className="w-3 h-3" />
                  {t("visits.mandatory")}
                </span>
              )}
            </div>
            <p className="font-bold text-ink-900 text-[14px] leading-snug">{name}</p>
            <p className="text-[11.5px] text-ink-400 font-mono mt-0.5">
              {item.product.sku}
              {item.min_stock > 0 && (
                <span className="ms-2 text-ink-400">
                  {t("visits.minStock")}: {item.min_stock} {item.product.unit}
                </span>
              )}
            </p>
          </div>
          {hasValue && (
            <div className="shrink-0 mt-0.5">
              {isEmpty    ? <XCircle       className="w-5 h-5 text-rose-400" /> :
               isBelowMin ? <AlertTriangle className="w-5 h-5 text-amber-400" /> :
                            <CheckCircle2  className="w-5 h-5 text-emerald-500" />}
            </div>
          )}
        </div>
      </div>

      <div className="h-px bg-ink-100 mx-4" />

      <div className="px-4 py-4 space-y-3">
        <div>
          <label className="block text-[11.5px] font-semibold text-ink-500 uppercase tracking-wide mb-2">
            {t("visits.qtyFound")} ({item.product.unit})
          </label>
          {readOnly ? (
            <p className="text-[28px] font-bold text-ink-800">{item.qty_found ?? "—"}</p>
          ) : (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  const v = Math.max(0, (parseInt(entry.qty_found) || 0) - 1);
                  onChange(item.product_id, "qty_found", String(v));
                }}
                className="w-12 h-12 rounded-xl border-2 border-ink-200 flex items-center justify-center text-ink-500 hover:border-brand-400 hover:text-brand-500 active:scale-95 transition-all"
              >
                <Minus className="w-5 h-5" />
              </button>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={entry.qty_found}
                onChange={(e) => onChange(item.product_id, "qty_found", e.target.value)}
                placeholder="0"
                className="flex-1 h-14 text-center text-[28px] font-bold text-ink-900 rounded-xl border-2 border-ink-200 bg-white outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-50 transition-all"
              />
              <button
                type="button"
                onClick={() => {
                  const v = (parseInt(entry.qty_found) || 0) + 1;
                  onChange(item.product_id, "qty_found", String(v));
                }}
                className="w-12 h-12 rounded-xl border-2 border-ink-200 flex items-center justify-center text-ink-500 hover:border-brand-400 hover:text-brand-500 active:scale-95 transition-all"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>

        {hasValue && item.min_stock > 0 && (
          <div
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-lg text-[12.5px] font-semibold",
              qtyMissing === 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-600"
            )}
          >
            {qtyMissing === 0
              ? <CheckCircle2 className="w-3.5 h-3.5" />
              : <AlertTriangle className="w-3.5 h-3.5" />}
            {qtyMissing === 0
              ? "✓ OK"
              : `${t("visits.qtyMissing")}: ${qtyMissing} ${item.product.unit}`}
          </div>
        )}

        {!readOnly && (
          <textarea
            rows={1}
            value={entry.notes}
            onChange={(e) => onChange(item.product_id, "notes", e.target.value)}
            placeholder={t("visits.notesProductPlaceholder")}
            className="w-full px-3 py-2.5 rounded-xl border border-ink-100 bg-ink-50/50 text-[13px] text-ink-700 placeholder:text-ink-300 outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-50 transition-all resize-none"
          />
        )}
        {readOnly && item.notes && (
          <p className="text-[12.5px] text-ink-500 italic px-1">{item.notes}</p>
        )}
      </div>
    </div>
  );
}

// ─── Status banner ────────────────────────────────────────────────────────────

function StatusBanner({ status, t }: { status: string; t: TranslationFn }) {
  if (status === "completed") {
    return (
      <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-50 border border-emerald-200 mb-6">
        <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
        <p className="text-[13px] text-emerald-700 font-medium">
          {t("visits.completedReadOnly")}
        </p>
      </div>
    );
  }
  if (status === "missed") {
    return (
      <div className="flex items-center gap-3 p-4 rounded-xl bg-rose-50 border border-rose-200 mb-6">
        <XCircle className="w-5 h-5 text-rose-400 shrink-0" />
        <p className="text-[13px] text-rose-600 font-medium">{t("visits.missedNote")}</p>
      </div>
    );
  }
  return null;
}

// ─── GPS check-in panel ───────────────────────────────────────────────────────

type GpsPhase =
  | { status: "idle" }
  | { status: "detecting" }
  | { status: "no_coords" }
  | { status: "error";        message: string }
  | { status: "too_far";      distance: number; accuracy: number }
  | { status: "low_accuracy"; distance: number; accuracy: number; position: GpsPosition };

interface CheckinPanelProps {
  visit:      VisitWithDetails;
  isStarting: boolean;
  onStart:    (position?: GpsPosition) => void;
  locale:     string;
  t:          TranslationFn;
}

function CheckinPanel({ visit, isStarting, onStart, locale, t }: CheckinPanelProps) {
  const [phase, setPhase] = useState<GpsPhase>({ status: "idle" });

  async function detect() {
    if (visit.place.lat == null || visit.place.lng == null) {
      setPhase({ status: "no_coords" });
      return;
    }
    setPhase({ status: "detecting" });
    let pos: GpsPosition;
    try {
      pos = await getCurrentPosition();
    } catch (err) {
      setPhase({
        status:  "error",
        message: err instanceof Error ? err.message : t("visits.gpsError"),
      });
      return;
    }
    const dist = haversineDistance(
      pos.latitude, pos.longitude,
      visit.place.lat!, visit.place.lng!
    );
    if (dist > DEFAULT_CHECKIN_RADIUS_METERS) {
      setPhase({ status: "too_far", distance: dist, accuracy: pos.accuracy });
      return;
    }
    if (pos.accuracy > ACCURACY_WARNING_THRESHOLD_METERS) {
      setPhase({ status: "low_accuracy", distance: dist, accuracy: pos.accuracy, position: pos });
      return;
    }
    onStart(pos);
  }

  const { status } = phase;

  return (
    <div className="bg-white rounded-2xl border border-ink-100 mb-6 overflow-hidden shadow-sm">

      {status === "idle" && (
        <div className="flex flex-col items-center justify-center py-14 text-center px-6">
          <Package className="w-10 h-10 text-ink-300 mb-3" />
          <p className="text-[14px] text-ink-500 mb-5">{t("visits.startFirst")}</p>
          <button
            onClick={detect}
            disabled={isStarting}
            className="inline-flex items-center gap-2 h-12 px-8 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white text-[14px] font-semibold shadow-pop transition-all"
          >
            <Play className="w-4 h-4" />
            {isStarting ? t("common.loading") : t("visits.start")}
          </button>
        </div>
      )}

      {status === "detecting" && (
        <div className="flex flex-col items-center justify-center py-14 text-center px-6">
          <div className="w-14 h-14 rounded-full bg-brand-50 flex items-center justify-center mb-4">
            <MapPin className="w-7 h-7 text-brand-500 animate-pulse" />
          </div>
          <p className="text-[15px] font-semibold text-ink-800">{t("visits.gpsDetecting")}</p>
          <p className="text-[12.5px] text-ink-400 mt-1">
            {locale === "ar" ? "يُرجى الانتظار…" : "Please wait…"}
          </p>
        </div>
      )}

      {status === "no_coords" && (
        <div className="p-5 space-y-4">
          <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-[13px] font-semibold text-amber-800">{t("visits.gpsNoBranchCoords")}</p>
              <p className="text-[12px] text-amber-600 mt-0.5">
                {locale === "ar"
                  ? "لا يمكن التحقق من موقعك. يمكنك البدء بدون التحقق."
                  : "Location verification unavailable. You may start without it."}
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setPhase({ status: "idle" })}
              className="flex-1 h-11 rounded-xl border border-ink-200 text-ink-600 text-[13.5px] font-semibold hover:bg-ink-50 transition-all"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={() => onStart()}
              disabled={isStarting}
              className="flex-1 h-11 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white text-[13.5px] font-semibold shadow-pop transition-all"
            >
              {isStarting ? t("common.loading") : t("visits.gpsStartAnyway")}
            </button>
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="p-5 space-y-4">
          <div className="flex items-start gap-3 p-4 rounded-xl bg-rose-50 border border-rose-200">
            <XCircle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-[13px] font-semibold text-rose-700">{t("visits.gpsError")}</p>
              <p className="text-[12px] text-rose-500 mt-0.5 leading-snug">{phase.message}</p>
            </div>
          </div>
          <button
            onClick={detect}
            className="w-full h-11 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-[13.5px] font-semibold shadow-pop transition-all flex items-center justify-center gap-2"
          >
            <MapPin className="w-4 h-4" />
            {t("visits.gpsRetry")}
          </button>
        </div>
      )}

      {status === "too_far" && (
        <div className="p-5 space-y-4">
          <div className="flex items-start gap-3 p-4 rounded-xl bg-rose-50 border border-rose-200">
            <MapPin className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-[13px] font-semibold text-rose-700">
                {t("visits.gpsTooFar").replace("{distance}", String(Math.round(phase.distance)))}
              </p>
              <p className="text-[11.5px] text-rose-400 mt-1 font-mono" dir="ltr">
                ±{Math.round(phase.accuracy)} m {locale === "ar" ? "دقة" : "accuracy"}
              </p>
            </div>
          </div>
          <button
            onClick={detect}
            className="w-full h-11 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-[13.5px] font-semibold shadow-pop transition-all flex items-center justify-center gap-2"
          >
            <MapPin className="w-4 h-4" />
            {t("visits.gpsRetry")}
          </button>
        </div>
      )}

      {status === "low_accuracy" && (
        <div className="p-5 space-y-4">
          <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-[13px] font-semibold text-amber-800">
                {t("visits.gpsLowAccuracy").replace("{accuracy}", String(Math.round(phase.accuracy)))}
              </p>
              <p className="text-[12px] text-amber-600 mt-0.5">
                {locale === "ar"
                  ? `المسافة المقدّرة: ${Math.round(phase.distance)} م`
                  : `Estimated distance: ${Math.round(phase.distance)} m`}
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setPhase({ status: "idle" })}
              className="flex-1 h-11 rounded-xl border border-ink-200 text-ink-600 text-[13.5px] font-semibold hover:bg-ink-50 transition-all"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={() => onStart(phase.position)}
              disabled={isStarting}
              className="flex-1 h-11 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white text-[13.5px] font-semibold shadow-pop transition-all"
            >
              {isStarting ? t("common.loading") : t("visits.gpsCheckinAnyway")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Visit history (audit trail) ──────────────────────────────────────────────

function VisitHistorySection({ visitId, t }: { visitId: string; t: TranslationFn }) {
  const { data: logs = [], isLoading } = useEntityActivity("visit", visitId);

  // Hide the whole section until the visit has at least one recorded event
  // (also covers the pre-migration case where the table doesn't exist yet).
  if (!isLoading && logs.length === 0) return null;

  return (
    <div className="mt-8">
      <h2 className="text-[13px] font-bold text-ink-700 flex items-center gap-2 mb-4">
        <History className="w-4 h-4 text-brand-500" />
        {t("activity.visitHistory")}
      </h2>
      <ActivityTimeline logs={logs} isLoading={isLoading} showActor={true} />
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function VisitDetailPage() {
  const { t, locale } = useTranslation();
  const params        = useParams();
  const router        = useRouter();
  const id            = params.id as string;

  // ── Server data ──────────────────────────────────────────────────────────
  const { data: visit,         isLoading: visitLoading, isError, error } = useVisit(id);
  const { data: visitProducts = [], isLoading: productsLoading }         = useVisitProducts(id, visit?.place_id ?? "");
  const { data: visitResponses = [], isLoading: responsesLoading }       = useVisitResponses(id);

  const templateId = visit?.template_id ?? "";
  const { data: template } = useTemplate(templateId);

  // ── Mutations ────────────────────────────────────────────────────────────
  const startMutation    = useStartVisit();
  const missedMutation   = useMarkMissed();
  const saveProdMutation = useSaveVisitProducts(id);
  const saveRespMutation = useSaveVisitResponses(id);

  // ── Derived read-only flag (needed by offline hook) ──────────────────────
  const isReadOnly  = visit?.status === "completed" || visit?.status === "missed";
  const isInProgress = visit?.status === "inprogress";
  const isPending    = visit?.status === "pending";

  // ── Offline draft hook ───────────────────────────────────────────────────
  const {
    isOnline,
    syncStatus,
    pendingDraft,
    confirmRestore,
    discardDraft,
    updateDraft,
    markSaving,
    markSynced,
    markFailed,
    clearLocalDraft,
  } = useOfflineVisitDraft(id, isReadOnly);

  // ── Local audit state — products ─────────────────────────────────────────
  const [entries,      setEntries]      = useState<Entries>({});
  const [notes,        setNotes]        = useState("");
  const [showComplete, setShowComplete] = useState(false);
  const prodInitialized                 = useRef(false);

  useEffect(() => {
    if (visitProducts.length > 0 && !prodInitialized.current) {
      const initial: Entries = {};
      visitProducts.forEach((p) => {
        initial[p.product_id] = {
          qty_found: p.qty_found != null ? String(p.qty_found) : "",
          notes:     p.notes ?? "",
        };
      });
      setEntries(initial);
      prodInitialized.current = true;
    }
  }, [visitProducts]);

  useEffect(() => {
    if (visit?.notes) setNotes(visit.notes);
  }, [visit?.notes]);

  // ── Local audit state — template responses ───────────────────────────────
  const [responses,    setResponses]    = useState<FieldResponses>({});
  const respInitialized                 = useRef(false);

  useEffect(() => {
    if (respInitialized.current) return;
    if (!template?.fields) return;
    if (responsesLoading) return;

    const initial: FieldResponses = {};
    visitResponses.forEach((r) => {
      initial[r.field_id] = r.value;
    });
    setResponses(initial);
    respInitialized.current = true;
  }, [template?.fields, visitResponses, responsesLoading]);

  // ── Ref holding the latest entries+responses for draft writes ────────────
  // Kept in a ref so the callbacks below never go stale.
  const draftDataRef = useRef<{ entries: Entries; responses: FieldResponses }>({
    entries: {}, responses: {},
  });
  draftDataRef.current = { entries, responses };

  // ── Timer ─────────────────────────────────────────────────────────────────
  const elapsed = useElapsedTimer(
    visit?.status === "inprogress" ? visit.started_at : null
  );

  // ── Handlers ────────────────────────────────────────────────────────────

  /**
   * handleEntryChange — called on every product qty / notes edit.
   * Schedules a debounced draft write to localStorage.
   */
  const handleEntryChange = useCallback(
    (productId: string, field: keyof ProductEntry, value: string) => {
      setEntries((prev) => {
        const next = {
          ...prev,
          [productId]: { ...(prev[productId] ?? { qty_found: "", notes: "" }), [field]: value },
        };
        // Pass next entries + current responses (from ref, always fresh)
        updateDraft(next as DraftProducts, draftDataRef.current.responses);
        return next;
      });
    },
    [updateDraft],
  );

  /**
   * handleResponseChange — called on every template field edit.
   */
  const handleResponseChange = useCallback(
    (fieldId: string, value: unknown) => {
      setResponses((prev) => {
        const next = { ...prev, [fieldId]: value };
        // Pass current entries (from ref) + next responses
        updateDraft(draftDataRef.current.entries as DraftProducts, next);
        return next;
      });
    },
    [updateDraft],
  );

  function buildSaveItems() {
    return visitProducts.map((p) => {
      const e          = entries[p.product_id] ?? { qty_found: "", notes: "" };
      const qtyFound   = e.qty_found !== "" ? parseInt(e.qty_found) : null;
      const qtyMissing = qtyFound != null && p.min_stock > 0
        ? Math.max(0, p.min_stock - qtyFound)
        : null;
      return { product_id: p.product_id, qty_found: qtyFound, qty_missing: qtyMissing, notes: e.notes || null };
    });
  }

  function buildResponseItems() {
    if (!template?.fields) return [];
    return template.fields
      .filter((f) => f.type !== "section")
      .map((f) => ({ field_id: f.id, value: responses[f.id] ?? null }));
  }

  /**
   * handleSave — syncs products + responses to the server.
   * When offline: skips the network call and acknowledges the local draft.
   */
  async function handleSave() {
    if (!isOnline) {
      // Draft is already in localStorage (auto-saved on every edit).
      toast.info(t("offline.savedLocallyToast"));
      return;
    }

    markSaving();
    try {
      const saves: Promise<unknown>[] = [
        saveProdMutation.mutateAsync(buildSaveItems()),
      ];
      if (templateId && template?.fields.length) {
        saves.push(
          saveRespMutation.mutateAsync({
            templateId,
            items: buildResponseItems(),
          })
        );
      }
      await Promise.all(saves);
      markSynced();
    } catch {
      // Error toast is already shown by the mutation's onError handler.
      markFailed();
    }
  }

  async function handleStart(position?: GpsPosition) {
    await startMutation.mutateAsync({ visitId: id, position });
    prodInitialized.current = false;
    respInitialized.current = false;
  }

  /** Restore the pending draft into page state, then clear the prompt. */
  function handleRestoreDraft() {
    if (!pendingDraft) return;
    setEntries(pendingDraft.products as Entries);
    setResponses(pendingDraft.responses as FieldResponses);
    confirmRestore();
    toast.success(t("offline.restoredOk"));
  }

  /** Discard the pending draft — keep server data. */
  function handleDiscardDraft() {
    discardDraft();
    toast.success(t("offline.discardedOk"));
  }

  // ── Derived ─────────────────────────────────────────────────────────────
  const isSaving  = saveProdMutation.isPending || saveRespMutation.isPending;

  const branchName = visit
    ? (locale === "ar" ? visit.place.branch_ar : visit.place.branch_en)
    : "";
  const chainName  = visit
    ? (locale === "ar" ? visit.place.chain?.name_ar : visit.place.chain?.name_en)
    : "";
  const chainColor = visit?.place.chain?.color ?? "#6366F1";
  const merchName  = visit?.merch.user?.full_name ?? "";
  const merchColor = visit?.merch.color ?? "#6366F1";
  const isRtl      = locale === "ar";
  const BackIcon   = isRtl ? ArrowRight : ArrowLeft;

  const templateName = template
    ? (locale === "ar" ? template.name_ar : template.name_en)
    : "";

  // ── Loading ──────────────────────────────────────────────────────────────
  if (visitLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-32 rounded-lg bg-ink-100 animate-pulse" />
        <div className="h-28 rounded-2xl bg-ink-100 animate-pulse" />
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-40 rounded-2xl bg-ink-100 animate-pulse" />
        ))}
      </div>
    );
  }

  if (isError || !visit) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <AlertCircle className="w-10 h-10 text-rose-400 mb-3" />
        <p className="text-[13px] text-rose-500">
          {(error as Error)?.message ?? t("common.noData")}
        </p>
        <Link href="/visits" className="mt-4 text-[13px] text-brand-500 hover:underline">
          ← {t("visits.backToList")}
        </Link>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Back nav ─────────────────────────────────────────────────────── */}
      <div className="mb-5">
        <Link
          href="/visits"
          className="inline-flex items-center gap-1.5 text-[13px] text-ink-500 hover:text-ink-800 transition-colors"
        >
          <BackIcon className="w-4 h-4" />
          {t("visits.backToList")}
        </Link>
      </div>

      {/* ── Offline banner ───────────────────────────────────────────────── */}
      {!isOnline && (
        <div className="flex items-center gap-2.5 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl mb-5">
          <WifiOff className="w-4 h-4 text-amber-500 shrink-0" />
          <p className="text-[13px] text-amber-700 font-medium">{t("offline.banner")}</p>
        </div>
      )}

      {/* ── Draft restore prompt ─────────────────────────────────────────── */}
      {pendingDraft && !isReadOnly && (
        <RestorePromptBanner
          savedAt={pendingDraft.last_saved_locally_at}
          locale={locale}
          t={t}
          onRestore={handleRestoreDraft}
          onDiscard={handleDiscardDraft}
        />
      )}

      {/* ── Info card ────────────────────────────────────────────────────── */}
      <div
        className="rounded-2xl border border-ink-100 bg-white overflow-hidden mb-6 shadow-sm"
        style={{ borderTopColor: chainColor, borderTopWidth: 4 }}
      >
        <div className="p-5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            {/* Branch */}
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <MapPin className="w-4 h-4 text-ink-400 shrink-0" />
                <p className="text-[12px] font-semibold text-ink-400 uppercase tracking-wide">
                  {t("visits.branchDetail")}
                </p>
              </div>
              <p className="text-[17px] font-bold text-ink-900 leading-tight">{branchName}</p>
              {chainName && (
                <p className="text-[13px] text-ink-400 mt-0.5">
                  {chainName} · {visit.place.code}
                </p>
              )}
            </div>

            {/* Merch */}
            <div className="flex items-center gap-3 sm:border-s sm:border-ink-100 sm:ps-4">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-[13px] shrink-0"
                style={{ backgroundColor: merchColor }}
              >
                {(merchName[0] ?? "?").toUpperCase()}
              </div>
              <div>
                <p className="text-[12px] font-semibold text-ink-400 flex items-center gap-1">
                  <User className="w-3 h-3" />
                  {t("visits.merchDetail")}
                </p>
                <p className="text-[14px] font-semibold text-ink-800">{merchName}</p>
              </div>
            </div>
          </div>

          {/* Metadata row */}
          <div className="flex flex-wrap items-center gap-4 mt-4 pt-4 border-t border-ink-100">
            <span className="flex items-center gap-1.5 text-[12.5px] text-ink-500">
              <CalendarDays className="w-3.5 h-3.5" />
              {new Date(visit.scheduled_date + "T12:00:00").toLocaleDateString(
                locale === "ar" ? "ar-SA" : "en-GB",
                { weekday: "long", day: "numeric", month: "long", year: "numeric" }
              )}
            </span>

            {visit.started_at && (
              <span className="flex items-center gap-1.5 text-[12.5px] text-ink-500">
                <Clock className="w-3.5 h-3.5" />
                {new Date(visit.started_at).toLocaleTimeString([], {
                  hour: "2-digit", minute: "2-digit",
                })}
              </span>
            )}

            {/* Template badge */}
            {visit.template && (
              <span className="flex items-center gap-1.5 text-[12.5px] text-brand-600 bg-brand-50 border border-brand-100 rounded-full px-2.5 py-0.5">
                <FileText className="w-3 h-3" />
                {locale === "ar" ? visit.template.name_ar : visit.template.name_en}
              </span>
            )}

            {/* GPS verified badge */}
            {visit.checkin_verified && visit.checkin_distance_meters != null && (
              <span className="flex items-center gap-1.5 text-[12.5px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-0.5">
                <ShieldCheck className="w-3 h-3" />
                {t("visits.gpsVerified").replace(
                  "{distance}",
                  String(Math.round(visit.checkin_distance_meters))
                )}
              </span>
            )}

            {isInProgress && elapsed && (
              <span className="flex items-center gap-1.5 text-[12.5px] font-bold text-blue-600 ms-auto">
                <Clock className="w-3.5 h-3.5 animate-pulse" />
                {t("visits.timer")}: {elapsed}
              </span>
            )}

            {visit.status === "completed" && visit.duration_minutes > 0 && (
              <span className="flex items-center gap-1.5 text-[12.5px] text-emerald-600 ms-auto font-semibold">
                <Clock className="w-3.5 h-3.5" />
                {t("visits.minutes").replace("{n}", String(visit.duration_minutes))}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Status banners ───────────────────────────────────────────────── */}
      <StatusBanner status={visit.status} t={t} />

      {/* ── Pending: GPS check-in panel ──────────────────────────────────── */}
      {isPending && (
        <CheckinPanel
          visit={visit}
          isStarting={startMutation.isPending}
          onStart={handleStart}
          locale={locale}
          t={t}
        />
      )}

      {/* ── Active / read-only content ───────────────────────────────────── */}
      {(isInProgress || isReadOnly) && (
        <div className="mb-32 space-y-0">

          {/* ── Template fields ──────────────────────────────────────────── */}
          {templateId && template && template.fields.length > 0 && (
            <TemplateFieldSection
              templateName={templateName}
              fields={template.fields}
              responses={responses}
              visitId={id}
              templateId={templateId}
              readOnly={isReadOnly}
              isOnline={isOnline}
              locale={locale}
              t={t}
              onChange={handleResponseChange}
            />
          )}

          {templateId && !template && (
            <div className="h-24 rounded-2xl bg-ink-100 animate-pulse mb-6" />
          )}

          {/* ── Product checklist ─────────────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[13px] font-bold text-ink-700 flex items-center gap-2">
                <Package className="w-4 h-4 text-brand-500" />
                {t("visits.sectionProducts")}
              </h2>
              {visitProducts.length > 0 && (
                <span className="text-[12px] text-ink-400">
                  {visitProducts.filter((p) => entries[p.product_id]?.qty_found !== "").length}
                  {" / "}
                  {visitProducts.length}
                </span>
              )}
            </div>

            {productsLoading && (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-36 rounded-2xl bg-ink-100 animate-pulse" />
                ))}
              </div>
            )}

            {!productsLoading && visitProducts.length === 0 && (
              <div className="flex flex-col items-center justify-center py-14 bg-white rounded-2xl border border-ink-100 text-center">
                <Package className="w-8 h-8 text-ink-300 mb-2" />
                <p className="text-[13px] text-ink-400">{t("visits.noProducts")}</p>
              </div>
            )}

            {!productsLoading && visitProducts.length > 0 && (
              <div className="space-y-3">
                {visitProducts.map((item) => (
                  <ProductCard
                    key={item.product_id}
                    item={item}
                    entry={entries[item.product_id] ?? { qty_found: "", notes: "" }}
                    readOnly={isReadOnly}
                    locale={locale}
                    t={t}
                    onChange={handleEntryChange}
                  />
                ))}
              </div>
            )}

            {/* General notes */}
            {isInProgress && (
              <div className="mt-5">
                <label className="block text-[12.5px] font-semibold text-ink-700 mb-2">
                  {t("visits.sectionNotes")}
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder={t("visits.notesPlaceholder")}
                  className="w-full px-4 py-3 rounded-xl border border-ink-200 bg-white text-[13px] text-ink-800 placeholder:text-ink-300 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-50 transition-all resize-none"
                />
              </div>
            )}
          </div>

          {/* ── Visit history (audit trail) ────────────────────────────────── */}
          <VisitHistorySection visitId={id} t={t} />
        </div>
      )}

      {/* ── Sticky action bar ────────────────────────────────────────────── */}
      {isInProgress && (
        <div className="fixed bottom-0 start-0 end-0 z-40 bg-white border-t border-ink-200">
          <div className="max-w-4xl mx-auto px-4">

            {/* Sync status row */}
            <div className="flex items-center justify-center pt-2 min-h-[24px]">
              <SyncStatusPill status={syncStatus} isOnline={isOnline} t={t} />
            </div>

            {/* Action buttons */}
            <div className="flex gap-3 pb-safe pt-1.5">
              {/* Mark missed */}
              <button
                onClick={() => missedMutation.mutate(id)}
                disabled={missedMutation.isPending}
                title={t("visits.markMissed")}
                className="w-12 h-12 rounded-xl border border-ink-200 flex items-center justify-center text-ink-400 hover:text-rose-500 hover:border-rose-300 hover:bg-rose-50 transition-all shrink-0"
              >
                <XCircle className="w-5 h-5" />
              </button>

              {/* Save (disabled inline when server is busy; offline shows info toast) */}
              <button
                onClick={handleSave}
                disabled={isSaving || syncStatus === "saving"}
                className="flex-1 h-12 rounded-xl border-2 border-brand-500 text-brand-600 text-[14px] font-semibold hover:bg-brand-50 disabled:opacity-60 transition-all flex items-center justify-center gap-2"
              >
                {syncStatus === "saving" ? (
                  <CloudUpload className="w-4 h-4 animate-pulse" />
                ) : !isOnline ? (
                  <WifiOff className="w-4 h-4" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                {t("visits.saveProducts")}
              </button>

              {/* Complete — disabled when offline */}
              <button
                onClick={() => setShowComplete(true)}
                disabled={!isOnline}
                title={!isOnline ? t("offline.completeOfflineDisabled") : undefined}
                className={cn(
                  "flex-1 h-12 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-[14px] font-semibold shadow-pop transition-all flex items-center justify-center gap-2",
                  !isOnline && "opacity-50 cursor-not-allowed hover:bg-emerald-500"
                )}
              >
                <CheckSquare className="w-4 h-4" />
                {t("visits.complete")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Complete modal ───────────────────────────────────────────────── */}
      {showComplete && (
        <CompleteModal
          visit={visit}
          products={visitProducts.map((p) => {
            const e = entries[p.product_id] ?? { qty_found: "", notes: "" };
            return {
              ...p,
              qty_found:   e.qty_found !== "" ? parseInt(e.qty_found) : null,
              qty_missing: null,
            };
          })}
          notes={notes}
          onClose={() => setShowComplete(false)}
          onDone={() => {
            clearLocalDraft();   // visit is done — draft no longer needed
            setShowComplete(false);
            router.push("/visits");
          }}
        />
      )}
    </>
  );
}
