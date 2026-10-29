import * as turf from "@turf/turf";

/** A spot the client tapped on their property, as [lng, lat]. */
export type PreEvalTap = [number, number];

export const MAX_TAPS = 20;
// Taps farther than this from the property are a mis-tap or a panned-away
// map, not part of the job.
export const MAX_TAP_DISTANCE_METERS = 500;

/**
 * Validates taps coming from the public pre-eval page. Returns null if
 * anything is off, so a bad request never half-saves.
 */
export function parsePreEvalTaps(
  input: unknown,
  property: { lng: number; lat: number }
): PreEvalTap[] | null {
  if (!Array.isArray(input) || input.length > MAX_TAPS) return null;

  const taps: PreEvalTap[] = [];
  for (const tap of input) {
    if (!Array.isArray(tap) || tap.length !== 2) return null;
    const [lng, lat] = tap;
    if (typeof lng !== "number" || typeof lat !== "number") return null;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;

    const meters = turf.distance([property.lng, property.lat], [lng, lat], { units: "meters" });
    if (meters > MAX_TAP_DISTANCE_METERS) return null;

    taps.push([lng, lat]);
  }
  return taps;
}

/** Reads the stored jsonb column, dropping anything malformed. */
export function readStoredTaps(value: unknown): PreEvalTap[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (t): t is PreEvalTap =>
      Array.isArray(t) && t.length === 2 && typeof t[0] === "number" && typeof t[1] === "number"
  );
}
