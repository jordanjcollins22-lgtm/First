import * as turf from "@turf/turf";
import type { Feature, Polygon } from "geojson";

import type { AttractorGeometry, AttractorGeometryType, AttractorWave, LatLng } from "@/types/domain";

/** Converts a wave's flexible geometry into a single GeoJSON polygon for
 * mapping/coverage checks. Returns null for zip_list waves (nothing to draw)
 * or malformed geometry. */
export function waveToPolygon(wave: Pick<AttractorWave, "geometry_type" | "geometry">): Feature<Polygon> | null {
  return geometryToPolygon(wave.geometry_type, wave.geometry);
}

export function geometryToPolygon(type: AttractorGeometryType, geometry: AttractorGeometry): Feature<Polygon> | null {
  try {
    if (type === "point_radius") {
      const g = geometry as { lat: number; lng: number; radius_miles: number };
      if (!Number.isFinite(g.lat) || !Number.isFinite(g.lng) || !g.radius_miles) return null;
      return turf.circle([g.lng, g.lat], g.radius_miles, { units: "miles", steps: 48 });
    }
    if (type === "polygon") {
      const g = geometry as { points: LatLng[] };
      if (!g.points || g.points.length < 3) return null;
      const coords = g.points.map((p) => [p.lng, p.lat]);
      coords.push(coords[0]);
      return turf.polygon([coords]);
    }
    if (type === "route") {
      const g = geometry as { points: LatLng[]; buffer_miles: number };
      if (!g.points || g.points.length < 2) return null;
      const line = turf.lineString(g.points.map((p) => [p.lng, p.lat]));
      const buffered = turf.buffer(line, g.buffer_miles || 0.1, { units: "miles" });
      return (buffered as Feature<Polygon>) ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

/** Every real lat/lng point referenced by a geometry — used for bounding-box
 * and projection math (Galaxy View) without needing a full polygon. */
export function geometryPoints(type: AttractorGeometryType, geometry: AttractorGeometry): LatLng[] {
  if (type === "point_radius") {
    const g = geometry as { lat: number; lng: number };
    return Number.isFinite(g.lat) && Number.isFinite(g.lng) ? [{ lat: g.lat, lng: g.lng }] : [];
  }
  if (type === "polygon" || type === "route") {
    const g = geometry as { points: LatLng[] };
    return g.points ?? [];
  }
  return [];
}

export function pointInWaveGeometry(point: LatLng, wave: Pick<AttractorWave, "geometry_type" | "geometry">): boolean {
  const polygon = waveToPolygon(wave);
  if (!polygon) return false;
  try {
    return turf.booleanPointInPolygon([point.lng, point.lat], polygon);
  } catch {
    return false;
  }
}

/** A simple local projection (equirectangular, longitude compressed by
 * cos(latitude) of the origin) so real geographic shapes/distances stay
 * proportional when flattened onto a 2D canvas. Returns miles from origin. */
export function projectToMiles(point: LatLng, origin: LatLng): { x: number; y: number } {
  const milesPerDegLat = 69.0;
  const milesPerDegLng = 69.172 * Math.cos((origin.lat * Math.PI) / 180);
  return {
    x: (point.lng - origin.lng) * milesPerDegLng,
    y: (point.lat - origin.lat) * milesPerDegLat,
  };
}

/** Inverse of projectToMiles: an x/y offset in miles from an origin back to lat/lng. */
export function milesToLatLng(offset: { x: number; y: number }, origin: LatLng): LatLng {
  const milesPerDegLat = 69.0;
  const milesPerDegLng = 69.172 * Math.cos((origin.lat * Math.PI) / 180);
  return {
    lat: origin.lat + offset.y / milesPerDegLat,
    lng: origin.lng + offset.x / milesPerDegLng,
  };
}
