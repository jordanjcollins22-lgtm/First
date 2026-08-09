/**
 * "Clean Up Shape" — deterministic geometry simplification (no LLM, v1).
 *
 * Straightens jagged/sloppy traces and closes polygons cleanly using
 * Douglas-Peucker simplification (turf.simplify). Never overwrites
 * original_geometry — callers store the result alongside it as
 * cleaned_geometry. If the resulting area changes by more than ~2%,
 * the cleanup is NOT auto-applied; the caller must show the before/after
 * delta to the estimator for explicit confirmation.
 */
import * as turf from "@turf/turf";
import type { Feature, Geometry, Polygon, MultiPolygon } from "geojson";

import { areaDeltaPercent } from "@/lib/measurement";

const AUTO_APPLY_AREA_DELTA_THRESHOLD = 0.02; // 2%
const DEFAULT_TOLERANCE_FT = 1.5;

export interface CleanupResult {
  cleaned: Feature<Geometry>;
  areaDeltaPercent: number | null;
  autoApplied: boolean;
  requiresConfirmation: boolean;
}

function closePolygonRings(feature: Feature<Polygon | MultiPolygon>) {
  const closeRing = (ring: number[][]) => {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      return [...ring, first];
    }
    return ring;
  };

  if (feature.geometry.type === "Polygon") {
    feature.geometry.coordinates = feature.geometry.coordinates.map(closeRing);
  } else {
    feature.geometry.coordinates = feature.geometry.coordinates.map((poly) =>
      poly.map(closeRing)
    );
  }
  return feature;
}

/**
 * Runs deterministic cleanup on a work area geometry: closes polygon rings,
 * then applies Douglas-Peucker simplification to straighten near-linear
 * segments and drop jitter points introduced by imprecise touch/mouse
 * tracing.
 */
export function cleanUpShape(
  original: Feature<Geometry>,
  toleranceFt: number = DEFAULT_TOLERANCE_FT
): CleanupResult {
  const toleranceDegrees = turf.lengthToDegrees(
    toleranceFt * 0.3048,
    "meters"
  );

  let working: Feature<Geometry> = turf.clone(original);

  if (working.geometry.type === "Polygon" || working.geometry.type === "MultiPolygon") {
    working = closePolygonRings(working as Feature<Polygon | MultiPolygon>);
  }

  const simplified = turf.simplify(working, {
    tolerance: toleranceDegrees,
    highQuality: true,
    mutate: true,
  });

  if (
    working.geometry.type === "Polygon" ||
    working.geometry.type === "MultiPolygon"
  ) {
    const delta = areaDeltaPercent(original, simplified);
    const autoApplied = delta <= AUTO_APPLY_AREA_DELTA_THRESHOLD;
    return {
      cleaned: simplified,
      areaDeltaPercent: delta,
      autoApplied,
      requiresConfirmation: !autoApplied,
    };
  }

  // Lines/points: no area concept, so simplification is always safe to apply.
  return {
    cleaned: simplified,
    areaDeltaPercent: null,
    autoApplied: true,
    requiresConfirmation: false,
  };
}
