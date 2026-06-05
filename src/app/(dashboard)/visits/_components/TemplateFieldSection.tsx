"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import {
  Camera, ScanLine, MapPin, X, Image as ImageIcon,
  RefreshCw, WifiOff, Upload,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils/cn";
import type { TemplateFieldFull } from "@/types";
import type { TranslationFn } from "@/hooks/use-translation";
import { usePhotoUpload } from "@/hooks/use-photo-upload";
import { isPhotoMeta, type PhotoMeta, MAX_PHOTO_SIZE_BYTES } from "@/services/storage";
import {
  getCurrentPosition,
  isGpsPosition,
  type GpsPosition,
} from "@/lib/geo";
import {
  useOfflinePhotoQueue,
} from "@/hooks/use-offline-photo-queue";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FieldResponses = Record<string, unknown>; // field_id → JSONB value

interface FieldInputProps {
  field:      TemplateFieldFull;
  value:      unknown;
  visitId:    string;
  templateId: string;
  readOnly:   boolean;
  isOnline:   boolean;
  locale:     string;
  t:          TranslationFn;
  onChange:   (fieldId: string, value: unknown) => void;
}

// ─── Shared input styles ──────────────────────────────────────────────────────

const inputCls =
  "w-full h-11 px-4 rounded-xl border border-ink-200 bg-white text-[13px] text-ink-800 " +
  "placeholder:text-ink-300 outline-none focus:border-brand-500 focus:ring-2 " +
  "focus:ring-brand-50 transition-all disabled:bg-ink-50 disabled:text-ink-500 disabled:cursor-not-allowed";

// ─── Photo field component ────────────────────────────────────────────────────
//
// Handles both the online upload path (existing behaviour unchanged) and the
// offline queue path (stores to IndexedDB, auto-uploads on reconnect).

interface PhotoFieldInputProps {
  field:      TemplateFieldFull;
  value:      unknown;
  visitId:    string;
  templateId: string;
  readOnly:   boolean;
  isOnline:   boolean;
  locale:     string;
  t:          TranslationFn;
  onChange:   (fieldId: string, value: unknown) => void;
}

function PhotoFieldInput({
  field,
  value,
  visitId,
  templateId,
  readOnly,
  isOnline,
  locale,
  t,
  onChange,
}: PhotoFieldInputProps) {
  // ── Online upload (unchanged behaviour) ──────────────────────────────────
  const { uploading, upload, remove, getUrl } = usePhotoUpload(visitId, field.id);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Offline queue for this specific field ─────────────────────────────────
  const { state: queueState, enqueue, retry, cancel } = useOfflinePhotoQueue(
    visitId,
    field.id,
    templateId,
    // Called after successful auto-upload; updates page responses state AND
    // shows a success toast.
    (fId, meta) => {
      onChange(fId, meta);
      toast.success(t("photo.syncedOk"));
    },
  );

  // ── Resolve stored value ──────────────────────────────────────────────────
  const photoMeta: PhotoMeta | null = isPhotoMeta(value) ? value : null;

  // ── Signed URL for server-stored photo preview ────────────────────────────
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  const loadPreview = useCallback(
    async (path: string) => {
      const url = await getUrl(path);
      setSignedUrl(url);
    },
    [getUrl],
  );

  useEffect(() => {
    if (!photoMeta?.path) { setSignedUrl(null); return; }
    loadPreview(photoMeta.path);
  }, [photoMeta?.path, loadPreview]);

  // ── Derived display state ─────────────────────────────────────────────────
  //
  // Precedence:
  //   1. Real PhotoMeta  → show signed URL preview (normal online flow)
  //   2. Queue has blob  → show blob URL preview + status badge
  //   3. Neither         → show upload button (or "no photo" in read-only)
  //
  const isQueued    = queueState.status === "pending";
  const isQueueBusy = queueState.status === "uploading";
  const isFailed    = queueState.status === "failed";
  const hasQueueItem = isQueued || isQueueBusy || isFailed;

  // Show the queue UI only when there is a queued item and no real photo yet.
  const showQueuedUI = hasQueueItem && !photoMeta;

  // The actual preview URL (blob for queue, signed URL for uploaded photo).
  const previewUrl = queueState.localUrl ?? signedUrl;

  // ── File selection handler ─────────────────────────────────────────────────

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset so the same file can be re-selected after removal.
    e.target.value = "";

    // ── Validate ────────────────────────────────────────────────────────────
    if (!file.type.startsWith("image/")) {
      toast.error(t("photo.invalidMime"));
      return;
    }
    if (file.size > MAX_PHOTO_SIZE_BYTES) {
      toast.error(t("photo.tooLarge"));
      return;
    }

    // Remove previous uploaded photo if replacing.
    if (photoMeta?.path) {
      await remove(photoMeta.path);
      onChange(field.id, null);
    }

    if (!isOnline) {
      // ── Offline path — store in IndexedDB ─────────────────────────────────
      const localUrl = await enqueue(file);
      if (localUrl) {
        toast.info(t("photo.savedOffline"));
      } else {
        // enqueue returned null → validation failed (should not happen here
        // since we already validated above, but guard anyway).
        toast.error(t("visits.errorPhotoUpload"));
      }
      return;
    }

    // ── Online path — upload immediately (unchanged) ──────────────────────
    const meta = await upload(file);
    if (meta) {
      onChange(field.id, meta);
    }
  }

  // ── Remove handler ────────────────────────────────────────────────────────

  async function handleRemove() {
    if (photoMeta?.path) await remove(photoMeta.path);
    setSignedUrl(null);
    onChange(field.id, null);
  }

  // ── Hidden file input ─────────────────────────────────────────────────────

  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/*"
      className="hidden"
      onChange={handleFileChange}
    />
  );

  // ── Read-only, no photo, no queued item ───────────────────────────────────

  if (readOnly && !photoMeta && !hasQueueItem) {
    return (
      <p className="text-[12.5px] text-ink-400 italic">
        {t("visits.noPhoto")}
      </p>
    );
  }

  // ── Queued / uploading / failed UI ────────────────────────────────────────

  if (showQueuedUI) {
    return (
      <div className="space-y-2">
        {/* Local blob preview */}
        {queueState.localUrl && (
          <div className="relative rounded-xl overflow-hidden border border-ink-200 bg-ink-50">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={queueState.localUrl}
              alt={locale === "ar" ? "معاينة محلية" : "Local preview"}
              className="w-full max-h-56 object-cover"
            />

            {/* Status badge overlay */}
            <div
              className={cn(
                "absolute top-2 start-2 flex items-center gap-1.5",
                "px-2.5 py-1 rounded-full text-[11px] font-bold",
                isQueued    && "bg-amber-500 text-white",
                isQueueBusy && "bg-blue-500 text-white",
                isFailed    && "bg-rose-500 text-white",
              )}
            >
              {isQueued    && <WifiOff className="w-3 h-3" />}
              {isQueueBusy && (
                <span className="w-2.5 h-2.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
              )}
              {isFailed    && <X className="w-3 h-3" />}
              <span>
                {isQueued    && t("photo.queued")}
                {isQueueBusy && t("visits.uploading")}
                {isFailed    && t("photo.uploadFailed")}
              </span>
            </div>
          </div>
        )}

        {/* Action bar */}
        {!readOnly && (
          <div className="flex gap-2">
            {isFailed && isOnline && (
              <button
                type="button"
                onClick={retry}
                className={cn(
                  "flex-1 h-9 rounded-xl bg-rose-50 border border-rose-200",
                  "text-rose-700 text-[12.5px] font-semibold",
                  "hover:bg-rose-100 transition-all",
                  "flex items-center justify-center gap-1.5",
                )}
              >
                <RefreshCw className="w-3.5 h-3.5" />
                {t("photo.retry")}
              </button>
            )}

            {/* Replace / re-select button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isQueueBusy || uploading}
              className={cn(
                "flex-1 h-9 rounded-xl border border-ink-200",
                "text-ink-600 text-[12.5px] font-semibold",
                "hover:bg-ink-50 disabled:opacity-50 transition-all",
                "flex items-center justify-center gap-1.5",
              )}
            >
              <Camera className="w-3.5 h-3.5" />
              {t("visits.replacePhoto")}
            </button>

            {/* Cancel / discard queued photo */}
            <button
              type="button"
              onClick={cancel}
              disabled={isQueueBusy}
              className={cn(
                "h-9 w-9 rounded-xl border border-rose-200 flex items-center justify-center",
                "text-rose-500 hover:bg-rose-50 disabled:opacity-50 transition-all shrink-0",
              )}
              title={locale === "ar" ? "إلغاء" : "Cancel"}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Offline notice under the image */}
        {isQueued && (
          <p className="text-[11px] text-amber-600 flex items-center gap-1">
            <WifiOff className="w-3 h-3 shrink-0" />
            {t("photo.willSyncWhenOnline")}
          </p>
        )}

        {fileInput}
      </div>
    );
  }

  // ── Has real PhotoMeta (server-stored) ────────────────────────────────────

  if (photoMeta) {
    return (
      <div className="space-y-2">
        {/* Image preview */}
        {previewUrl ? (
          <div className="relative rounded-xl overflow-hidden border border-ink-200 bg-ink-50">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt={photoMeta.file_name}
              className="w-full max-h-56 object-cover"
            />
            {/* Synced badge — visible for a moment after auto-upload */}
            {queueState.status === "uploaded" && (
              <div className="absolute top-2 start-2 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500 text-white text-[11px] font-bold">
                <Upload className="w-3 h-3" />
                {t("photo.syncedOk")}
              </div>
            )}
          </div>
        ) : (
          /* Fallback while signed URL loads */
          <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-ink-50 border border-ink-200">
            <ImageIcon className="w-4 h-4 text-ink-400 shrink-0" />
            <span className="text-[12.5px] text-ink-700 flex-1 truncate font-mono">
              {photoMeta.file_name}
            </span>
            <span className="text-[11px] text-ink-400 shrink-0">
              {(photoMeta.size / 1024).toFixed(0)} KB
            </span>
          </div>
        )}

        {/* Action bar — only in edit mode */}
        {!readOnly && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className={cn(
                "flex-1 h-9 rounded-xl border border-ink-200 text-[12.5px] font-semibold",
                "text-ink-600 hover:bg-ink-50 disabled:opacity-50 transition-all",
                "flex items-center justify-center gap-1.5",
              )}
            >
              {uploading ? (
                <span className="w-3.5 h-3.5 border-2 border-ink-400 border-t-transparent rounded-full animate-spin" />
              ) : (
                <Camera className="w-3.5 h-3.5" />
              )}
              {uploading ? t("visits.uploading") : t("visits.replacePhoto")}
            </button>

            <button
              type="button"
              onClick={handleRemove}
              disabled={uploading}
              className={cn(
                "h-9 w-9 rounded-xl border border-rose-200 flex items-center justify-center",
                "text-rose-500 hover:bg-rose-50 disabled:opacity-50 transition-all shrink-0",
              )}
              title={locale === "ar" ? "حذف الصورة" : "Remove photo"}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {fileInput}
      </div>
    );
  }

  // ── No photo + editable — upload button ──────────────────────────────────

  return (
    <>
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        className={cn(
          "w-full h-14 rounded-xl border-2 border-dashed border-ink-300",
          "flex flex-col items-center justify-center gap-1",
          "text-ink-500 hover:border-brand-400 hover:text-brand-600",
          "disabled:opacity-50 transition-all active:scale-[.98]",
        )}
      >
        {uploading ? (
          <>
            <span className="w-5 h-5 border-2 border-ink-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-[12px] font-medium">{t("visits.uploading")}</span>
          </>
        ) : (
          <>
            <Camera className="w-5 h-5" />
            <span className="text-[12px] font-medium">
              {!isOnline
                ? t("photo.addPhotoOffline")
                : t("visits.addPhoto")}
            </span>
          </>
        )}
      </button>
      {fileInput}
    </>
  );
}

// ─── Location field component ─────────────────────────────────────────────────
//
// Unchanged — offline photo queue does not affect the location field.

interface LocationFieldInputProps {
  field:    TemplateFieldFull;
  value:    unknown;
  readOnly: boolean;
  locale:   string;
  t:        TranslationFn;
  onChange: (fieldId: string, value: unknown) => void;
}

function LocationFieldInput({
  field,
  value,
  readOnly,
  locale,
  t,
  onChange,
}: LocationFieldInputProps) {
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const location: GpsPosition | null = isGpsPosition(value) ? value : null;

  async function handleCapture() {
    setCaptureError(null);
    setCapturing(true);
    try {
      const pos = await getCurrentPosition();
      onChange(field.id, pos);
    } catch (err) {
      setCaptureError(
        err instanceof Error ? err.message : t("visits.gpsError"),
      );
    } finally {
      setCapturing(false);
    }
  }

  if (readOnly && !location) {
    return (
      <p className="text-[12.5px] text-ink-400 italic">
        {locale === "ar" ? "لم يتم تحديد الموقع" : "No location captured"}
      </p>
    );
  }

  if (location) {
    return (
      <div className="space-y-2">
        <div className="flex items-start gap-3 px-3.5 py-3 rounded-xl bg-emerald-50 border border-emerald-200">
          <MapPin className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-[12.5px] font-semibold text-emerald-700">
              {t("visits.locationCaptured")}
            </p>
            <p className="text-[11px] text-emerald-600 font-mono mt-0.5" dir="ltr">
              {location.latitude.toFixed(5)}°, {location.longitude.toFixed(5)}°
            </p>
            <p className="text-[11px] text-emerald-500 mt-0.5">
              {t("visits.locationAccuracy").replace("{m}", String(Math.round(location.accuracy)))}
            </p>
          </div>
          {!readOnly && (
            <button
              type="button"
              onClick={() => { setCaptureError(null); onChange(field.id, null); }}
              className="w-5 h-5 rounded flex items-center justify-center text-ink-400 hover:text-rose-500 transition-colors shrink-0"
              title={locale === "ar" ? "حذف الموقع" : "Remove location"}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {!readOnly && (
          <button
            type="button"
            onClick={handleCapture}
            disabled={capturing}
            className={cn(
              "w-full h-9 rounded-xl border border-ink-200 text-[12.5px] font-semibold",
              "text-ink-600 hover:bg-ink-50 disabled:opacity-50 transition-all",
              "flex items-center justify-center gap-1.5",
            )}
          >
            {capturing ? (
              <span className="w-3.5 h-3.5 border-2 border-ink-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <MapPin className="w-3.5 h-3.5" />
            )}
            {capturing ? t("visits.gpsDetecting") : t("visits.locationRecapture")}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={handleCapture}
        disabled={capturing}
        className={cn(
          "w-full h-14 rounded-xl border-2 border-dashed border-ink-300",
          "flex flex-col items-center justify-center gap-1",
          "text-ink-500 hover:border-brand-400 hover:text-brand-600",
          "disabled:opacity-50 transition-all active:scale-[.98]",
        )}
      >
        {capturing ? (
          <>
            <span className="w-5 h-5 border-2 border-ink-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-[12px] font-medium">{t("visits.gpsDetecting")}</span>
          </>
        ) : (
          <>
            <MapPin className="w-5 h-5" />
            <span className="text-[12px] font-medium">{t("visits.captureLocation")}</span>
          </>
        )}
      </button>
      {captureError && (
        <p className="text-[11.5px] text-rose-500 leading-snug">{captureError}</p>
      )}
    </div>
  );
}

// ─── Individual field renderer ────────────────────────────────────────────────

function TemplateFieldInput({
  field,
  value,
  visitId,
  templateId,
  readOnly,
  isOnline,
  locale,
  t,
  onChange,
}: FieldInputProps) {
  const label    = locale === "ar" ? field.label_ar : field.label_en;
  const helpText = locale === "ar" ? field.help_text_ar : field.help_text_en;
  const dir      = locale === "ar" ? "rtl" : "ltr";

  if (field.type === "section") {
    return (
      <div className="py-1">
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-ink-200" />
          <span
            className="text-[11.5px] font-bold text-ink-500 uppercase tracking-widest shrink-0"
            dir={dir}
          >
            {label}
          </span>
          <div className="flex-1 h-px bg-ink-200" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {/* Label */}
      <label className="block text-[12.5px] font-semibold text-ink-700" dir={dir}>
        {label || <span className="italic text-ink-300">{t("templates.noLabel")}</span>}
        {field.required && <span className="text-rose-500 ms-1">*</span>}
      </label>

      {field.type === "text" && (
        <input
          type="text"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(field.id, e.target.value)}
          disabled={readOnly}
          placeholder={readOnly ? "—" : (locale === "ar" ? "اكتب هنا…" : "Type here…")}
          dir={dir}
          className={inputCls}
        />
      )}

      {field.type === "numeric" && (
        <div className="flex items-center gap-2">
          {!readOnly && (
            <button
              type="button"
              onClick={() => onChange(field.id, Math.max(0, ((value as number) ?? 0) - 1))}
              className="w-11 h-11 rounded-xl border-2 border-ink-200 flex items-center justify-center text-[20px] text-ink-500 hover:border-brand-400 hover:text-brand-500 active:scale-95 transition-all shrink-0"
            >
              −
            </button>
          )}
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={value !== undefined && value !== null ? String(value) : ""}
            onChange={(e) => onChange(field.id, e.target.value === "" ? null : Number(e.target.value))}
            disabled={readOnly}
            placeholder="0"
            className={cn(inputCls, "text-center text-[20px] font-bold")}
          />
          {!readOnly && (
            <button
              type="button"
              onClick={() => onChange(field.id, ((value as number) ?? 0) + 1)}
              className="w-11 h-11 rounded-xl border-2 border-ink-200 flex items-center justify-center text-[20px] text-ink-500 hover:border-brand-400 hover:text-brand-500 active:scale-95 transition-all shrink-0"
            >
              +
            </button>
          )}
        </div>
      )}

      {field.type === "yesno" && (
        <div className="flex gap-2">
          {(
            [
              {
                val:     true,
                label:   locale === "ar" ? "نعم" : "Yes",
                active:  "border-emerald-500 bg-emerald-50 text-emerald-700",
                passive: "border-ink-200 text-ink-600 hover:border-emerald-300",
              },
              {
                val:     false,
                label:   locale === "ar" ? "لا" : "No",
                active:  "border-rose-400 bg-rose-50 text-rose-600",
                passive: "border-ink-200 text-ink-600 hover:border-rose-300",
              },
            ] as const
          ).map(({ val, label: lbl, active, passive }) => (
            <button
              key={String(val)}
              type="button"
              disabled={readOnly}
              onClick={() => onChange(field.id, value === val ? null : val)}
              className={cn(
                "flex-1 h-11 rounded-xl border-2 font-semibold text-[13.5px] transition-all",
                value === val ? active : passive,
                readOnly && "cursor-default",
              )}
            >
              {lbl}
            </button>
          ))}
        </div>
      )}

      {field.type === "single" && (
        <div className="flex flex-wrap gap-2">
          {(field.options ?? []).length === 0 ? (
            <p className="text-[12px] text-ink-400 italic">{t("visits.noOptions")}</p>
          ) : (
            (field.options ?? []).map((opt) => (
              <button
                key={opt}
                type="button"
                disabled={readOnly}
                onClick={() => onChange(field.id, value === opt ? null : opt)}
                className={cn(
                  "px-4 h-9 rounded-full text-[13px] border-2 transition-all",
                  value === opt
                    ? "border-brand-500 bg-brand-50 text-brand-700 font-semibold"
                    : "border-ink-200 text-ink-600 hover:border-ink-300",
                  readOnly && "cursor-default",
                )}
              >
                {opt}
              </button>
            ))
          )}
        </div>
      )}

      {field.type === "multiple" && (() => {
        const selected = (value as string[]) ?? [];
        return (
          <div className="flex flex-wrap gap-2">
            {(field.options ?? []).length === 0 ? (
              <p className="text-[12px] text-ink-400 italic">{t("visits.noOptions")}</p>
            ) : (
              (field.options ?? []).map((opt) => {
                const isOn = selected.includes(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    disabled={readOnly}
                    onClick={() => {
                      const next = isOn
                        ? selected.filter((s) => s !== opt)
                        : [...selected, opt];
                      onChange(field.id, next.length ? next : null);
                    }}
                    className={cn(
                      "px-4 h-9 rounded-xl text-[13px] border-2 transition-all flex items-center gap-1.5",
                      isOn
                        ? "border-brand-500 bg-brand-50 text-brand-700 font-semibold"
                        : "border-ink-200 text-ink-600 hover:border-ink-300",
                      readOnly && "cursor-default",
                    )}
                  >
                    <span
                      className={cn(
                        "w-3 h-3 rounded-sm border-2 transition-all shrink-0",
                        isOn ? "bg-brand-500 border-brand-500" : "border-ink-300",
                      )}
                    />
                    {opt}
                  </button>
                );
              })
            )}
          </div>
        );
      })()}

      {/* ── Photo — offline-aware upload ──────────────────────────────────── */}
      {field.type === "photo" && (
        <PhotoFieldInput
          field={field}
          value={value}
          visitId={visitId}
          templateId={templateId}
          readOnly={readOnly}
          isOnline={isOnline}
          locale={locale}
          t={t}
          onChange={onChange}
        />
      )}

      {field.type === "date" && (
        <input
          type="date"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(field.id, e.target.value || null)}
          disabled={readOnly}
          className={inputCls}
        />
      )}

      {field.type === "barcode" && (
        <div className="flex gap-2">
          <input
            type="text"
            value={(value as string) ?? ""}
            onChange={(e) => onChange(field.id, e.target.value || null)}
            disabled={readOnly}
            placeholder={locale === "ar" ? "امسح أو أدخل الباركود…" : "Scan or type barcode…"}
            dir="ltr"
            className={cn(inputCls, "flex-1 font-mono")}
          />
          {!readOnly && (
            <button
              type="button"
              onClick={() => onChange(field.id, `BARCODE-${Date.now()}`)}
              title={locale === "ar" ? "مسح (مؤقت)" : "Scan (mock)"}
              className="w-11 h-11 rounded-xl bg-ink-50 border border-ink-200 flex items-center justify-center text-ink-500 hover:bg-brand-50 hover:text-brand-600 hover:border-brand-300 transition-all shrink-0"
            >
              <ScanLine className="w-4.5 h-4.5" />
            </button>
          )}
        </div>
      )}

      {/* ── Location — real GPS via browser Geolocation API ──────────────── */}
      {field.type === "location" && (
        <LocationFieldInput
          field={field}
          value={value}
          readOnly={readOnly}
          locale={locale}
          t={t}
          onChange={onChange}
        />
      )}

      {helpText && (
        <p className="text-[11.5px] text-ink-400" dir={dir}>
          {helpText}
        </p>
      )}
    </div>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

interface TemplateFieldSectionProps {
  templateName: string;
  fields:       TemplateFieldFull[];
  responses:    FieldResponses;
  visitId:      string;
  /** The template id — forwarded to photo fields for response persistence. */
  templateId:   string;
  readOnly:     boolean;
  /** Whether the device is currently connected to the internet. */
  isOnline:     boolean;
  locale:       string;
  t:            TranslationFn;
  onChange:     (fieldId: string, value: unknown) => void;
}

export function TemplateFieldSection({
  templateName,
  fields,
  responses,
  visitId,
  templateId,
  readOnly,
  isOnline,
  locale,
  t,
  onChange,
}: TemplateFieldSectionProps) {
  if (!fields.length) return null;

  return (
    <div className="mb-6">
      {/* Section header */}
      <div className="flex items-center gap-2 mb-4">
        <div className="w-1 h-5 rounded-full bg-brand-500" />
        <h2 className="text-[13px] font-bold text-ink-700 flex-1 truncate">
          {templateName}
        </h2>
        <span className="text-[11px] text-ink-400 shrink-0">
          {fields.filter((f) => f.type !== "section").length}{" "}
          {t("visits.templateFieldsCount")}
        </span>
      </div>

      {/* Fields */}
      <div className="bg-white rounded-2xl border border-ink-100 divide-y divide-ink-50 overflow-hidden shadow-sm">
        {fields.map((field) => (
          <div
            key={field.id}
            className={cn(
              "px-4 py-4",
              field.type === "section" && "px-4 py-3 bg-ink-50/50",
            )}
          >
            <TemplateFieldInput
              field={field}
              value={responses[field.id]}
              visitId={visitId}
              templateId={templateId}
              readOnly={readOnly}
              isOnline={isOnline}
              locale={locale}
              t={t}
              onChange={onChange}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
