"use server";

import { getCoverageMarkers, type CoverageBounds, type CoverageMarker } from "@/lib/data/coverage";

/**
 * The properties inside the map's current view.
 *
 * A server action rather than a route so the read goes through the signed-in
 * user's own access — a county of names and addresses is exactly the data that
 * should not be sitting behind an unauthenticated endpoint.
 */
export async function markersInView(bounds: CoverageBounds): Promise<CoverageMarker[]> {
  const sane = [bounds.west, bounds.south, bounds.east, bounds.north].every((n) => Number.isFinite(n));
  if (!sane) return [];
  return getCoverageMarkers(bounds).catch(() => []);
}
