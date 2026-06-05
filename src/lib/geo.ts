// ─── Constants ────────────────────────────────────────────────────────────────

/** Mean Earth radius (WGS-84). */
export const EARTH_RADIUS_METERS = 6_371_000;

/**
 * Maximum distance (metres) from the branch at which a check-in is accepted.
 * Can be overridden per-company in a future migration; hardcoded for now.
 */
export const DEFAULT_CHECKIN_RADIUS_METERS = 200;

/**
 * If the device reports GPS accuracy worse than this (metres), the UI shows
 * a low-accuracy warning and asks the user to confirm before proceeding.
 * The check-in is still allowed — this is a soft warning, not a hard block.
 */
export const ACCURACY_WARNING_THRESHOLD_METERS = 100;

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A captured GPS position.
 *
 * This is the canonical shape used in two places:
 *   1. As the JSONB value stored in visit_template_responses.value
 *      for template fields of type "location".
 *   2. As the check-in payload passed to startVisit() — the service
 *      extracts lat/lng/accuracy and writes them to separate DB columns.
 *
 * Future fields (add here and in migration when ready):
 *   heading?: number        — compass bearing in degrees
 *   altitude?: number       — metres above sea level
 *   speed?: number          — metres per second
 *   mock_location?: boolean — Android mock-location flag (anti-spoof)
 */
export interface GpsPosition {
  latitude:    number;
  longitude:   number;
  /** Device-reported 68th-percentile accuracy radius in metres. */
  accuracy:    number;
  /** ISO 8601 timestamp when the position was captured. */
  captured_at: string;
}

// ─── Type guard ───────────────────────────────────────────────────────────────

/**
 * Returns true if v is a GpsPosition object.
 * Returns false for old mock values ({ lat, lng, captured: true })
 * so they are treated as "no location captured" and can be re-taken.
 */
export function isGpsPosition(v: unknown): v is GpsPosition {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as GpsPosition).latitude === "number" &&
    typeof (v as GpsPosition).longitude === "number" &&
    typeof (v as GpsPosition).accuracy === "number" &&
    typeof (v as GpsPosition).captured_at === "string"
  );
}

// ─── Haversine distance ───────────────────────────────────────────────────────

/**
 * Calculate the great-circle distance (metres) between two WGS-84 coordinates
 * using the Haversine formula.
 *
 * Accuracy: within ~0.5% for distances under 500 km, which is more than
 * sufficient for a 200-metre check-in radius.
 */
export function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lng2 - lng1);

  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_METERS * c;
}

// ─── Browser Geolocation wrapper ─────────────────────────────────────────────

const DEFAULT_GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout:            15_000, // 15 s — balances accuracy vs wait time on mobile
  maximumAge:         0,      // always fresh; never use a cached position for check-in
};

/**
 * Promise-based wrapper around the browser Geolocation API.
 *
 * Converts GeolocationPositionError codes into human-readable messages.
 * The caller should display the error.message in the UI.
 *
 * @throws {Error} with a descriptive message on any failure.
 */
export function getCurrentPosition(
  options: PositionOptions = DEFAULT_GEO_OPTIONS
): Promise<GpsPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Geolocation is not supported by this browser or device."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          latitude:    pos.coords.latitude,
          longitude:   pos.coords.longitude,
          accuracy:    pos.coords.accuracy,
          captured_at: new Date().toISOString(),
        });
      },
      (err) => {
        switch (err.code) {
          case err.PERMISSION_DENIED:
            reject(
              new Error(
                "Location permission denied. Please enable it in your browser or device settings and try again."
              )
            );
            break;
          case err.POSITION_UNAVAILABLE:
            reject(
              new Error(
                "Location unavailable. Check that GPS is enabled on your device."
              )
            );
            break;
          case err.TIMEOUT:
            reject(
              new Error(
                "Location request timed out. Move to an open area for better signal and retry."
              )
            );
            break;
          default:
            reject(new Error("Failed to get location. Please try again."));
        }
      },
      options
    );
  });
}

// ─── Future-ready stubs (documented, not implemented yet) ─────────────────────
//
// watchPosition() — continuous tracking for route recording.
//   Returns a watchId; call navigator.geolocation.clearWatch(id) to stop.
//
// detectMockLocation() — Android mock-location heuristic.
//   Could check for suspiciously perfect accuracy (0 m), altitude anomalies,
//   or use the Android Fused Location Provider's isFromMockProvider field
//   (available via a native plugin on React Native; not accessible in PWA).
//
// These are listed here so the architecture is visible in one place.
// Implement in a future iteration along with the gps_flags DB column.
