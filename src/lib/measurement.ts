/**
 * SINGLE SOURCE OF TRUTH for all geospatial measurement math.
 *
 * Every consumer — the map UI, the (future) pricing engine, and the crew
 * checklist — must call `calculateMeasurements` rather than re-deriving
 * area/length from geometry themselves. This is the one place turf.js is
 * invoked for measurement purposes, so accuracy fixes and unit changes
 * only ever need to happen here.
 *
 * All math is geodesic (via Turf.js), operating on true [lng, lat]
 * coordinates. Never derive measurements from screen pixels.
 */
import * as turf from "@turf/turf";
import type { Feature, Geometry } from "geojson";

import type { CalculatedMeasurements, MeasurementType } from "@/types/domain";

const SQ_METERS_TO_SQ_FEET = 10.7639104167097;

export class UnsupportedGeometryError extends Error {
  constructor(geometryType: string) {
    super(`Unsupported geometry type for measurement: ${geometryType}`);
    this.name = "UnsupportedGeometryError";
  }
}

export function measurementTypeForGeometry(
  geometryType: Geometry["type"]
): MeasurementType {
  switch (geometryType) {
    case "Polygon":
    case "MultiPolygon":
      return "area";
    case "LineString":
    case "MultiLineString":
      return "length";
    case "Point":
    case "MultiPoint":
      return "count";
    default:
      throw new UnsupportedGeometryError(geometryType);
  }
}

/**
 * Compute area (sq ft) and perimeter (ft) for a polygon feature using
 * geodesic calculations. turf.area() returns square meters; we convert
 * to square feet for the US field-crew audience.
 */
function measurePolygon(feature: Feature<Geometry>): {
  area_sqft: number;
  perimeter_ft: number;
} {
  const areaSqMeters = turf.area(feature);
  const area_sqft = areaSqMeters * SQ_METERS_TO_SQ_FEET;

  const boundary = turf.polygonToLine(
    feature as Feature<import("geojson").Polygon | import("geojson").MultiPolygon>
  );
  const perimeter_ft = turf.length(boundary, { units: "feet" });

  return {
    area_sqft: roundTo(area_sqft, 1),
    perimeter_ft: roundTo(perimeter_ft, 1),
  };
}

function measureLine(feature: Feature<Geometry>): { length_ft: number } {
  const length_ft = turf.length(feature, { units: "feet" });
  return { length_ft: roundTo(length_ft, 1) };
}

function countPoints(feature: Feature<Geometry>): { point_count: number } {
  if (feature.geometry.type === "Point") return { point_count: 1 };
  if (feature.geometry.type === "MultiPoint") {
    return { point_count: feature.geometry.coordinates.length };
  }
  return { point_count: 1 };
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export interface CalculateMeasurementsOptions {
  /** Whether this measurement is being computed from the cleaned geometry. */
  source?: "original" | "cleaned";
  /** Version to stamp on the result (bumped after a geometry lock). */
  version?: number;
}

export function calculateMeasurements(
  feature: Feature<Geometry>,
  options: CalculateMeasurementsOptions = {}
): CalculatedMeasurements {
  const measurement_type = measurementTypeForGeometry(feature.geometry.type);
  const base = {
    measurement_type,
    calculated_at: new Date().toISOString(),
    geometry_source: options.source ?? "original",
    version: options.version ?? 1,
  } as const;

  switch (measurement_type) {
    case "area":
      return { ...base, ...measurePolygon(feature) };
    case "length":
      return { ...base, ...measureLine(feature) };
    case "count":
      return { ...base, ...countPoints(feature) };
  }
}

/** Percent difference in area between two polygon features, e.g. for the
 * "Clean Up Shape" 2% guard. Returns a value like 0.015 for 1.5%. */
export function areaDeltaPercent(
  original: Feature<Geometry>,
  cleaned: Feature<Geometry>
): number {
  const originalArea = turf.area(original);
  const cleanedArea = turf.area(cleaned);
  if (originalArea === 0) return cleanedArea === 0 ? 0 : 1;
  return Math.abs(cleanedArea - originalArea) / originalArea;
}

export function formatMeasurement(m: CalculatedMeasurements): string {
  switch (m.measurement_type) {
    case "area":
      return `${m.area_sqft?.toLocaleString()} sq ft (${m.perimeter_ft?.toLocaleString()} ft perimeter)`;
    case "length":
      return `${m.length_ft?.toLocaleString()} linear ft`;
    case "count":
      return `${m.point_count} point${m.point_count === 1 ? "" : "s"}`;
    default:
      return "—";
  }
}
