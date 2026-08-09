import { describe, expect, it } from "vitest";
import type { Feature, LineString, Point, Polygon } from "geojson";

import { areaDeltaPercent, calculateMeasurements } from "./measurement";

/**
 * Builds a geographic rectangle of the given real-world width/height (in
 * feet), anchored at (lat0, lng0), using standard WGS84-ish degree/meter
 * conversion constants (independent of Turf). This is our "hand-measured
 * reference shape" — the expected area/perimeter are known from plain
 * width * height arithmetic, not from Turf itself, so this test actually
 * verifies turf.area()/turf.length() against ground truth rather than
 * just checking Turf agrees with itself.
 */
function buildReferenceRectangle(
  lat0: number,
  lng0: number,
  widthFt: number,
  heightFt: number
): Feature<Polygon> {
  const FT_TO_M = 0.3048;
  const widthM = widthFt * FT_TO_M;
  const heightM = heightFt * FT_TO_M;

  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos((lat0 * Math.PI) / 180);

  const dLat = heightM / metersPerDegLat;
  const dLng = widthM / metersPerDegLng;

  const sw = [lng0, lat0];
  const se = [lng0 + dLng, lat0];
  const ne = [lng0 + dLng, lat0 + dLat];
  const nw = [lng0, lat0 + dLat];

  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [[sw, se, ne, nw, sw]],
    },
  };
}

describe("calculateMeasurements — real-world reference shapes", () => {
  it("matches a football field (360ft x 160ft) within 1%", () => {
    // Charlotte, NC — representative service area latitude.
    const feature = buildReferenceRectangle(35.2271, -80.8431, 360, 160);
    const result = calculateMeasurements(feature);

    expect(result.measurement_type).toBe("area");
    const expectedArea = 360 * 160; // 57,600 sq ft
    const expectedPerimeter = 2 * (360 + 160); // 1,040 ft

    expect(result.area_sqft).toBeDefined();
    expect(result.perimeter_ft).toBeDefined();

    const areaError =
      Math.abs((result.area_sqft as number) - expectedArea) / expectedArea;
    const perimeterError =
      Math.abs((result.perimeter_ft as number) - expectedPerimeter) /
      expectedPerimeter;

    expect(areaError).toBeLessThan(0.01);
    expect(perimeterError).toBeLessThan(0.01);
  });

  it("matches a small mulch bed (20ft x 10ft) within 1%", () => {
    const feature = buildReferenceRectangle(35.2271, -80.8431, 20, 10);
    const result = calculateMeasurements(feature);

    const expectedArea = 200;
    const expectedPerimeter = 60;

    const areaError =
      Math.abs((result.area_sqft as number) - expectedArea) / expectedArea;
    const perimeterError =
      Math.abs((result.perimeter_ft as number) - expectedPerimeter) /
      expectedPerimeter;

    expect(areaError).toBeLessThan(0.01);
    expect(perimeterError).toBeLessThan(0.01);
  });

  it("holds up at a very different latitude (Anchorage, AK)", () => {
    const feature = buildReferenceRectangle(61.2181, -149.9003, 100, 50);
    const result = calculateMeasurements(feature);

    const expectedArea = 5000;
    const areaError =
      Math.abs((result.area_sqft as number) - expectedArea) / expectedArea;

    expect(areaError).toBeLessThan(0.01);
  });

  it("computes linear feet for a fence/edging line against a known distance", () => {
    // 100ft due-east line at the equator, where 1 degree of longitude is
    // well-documented as ~364,000 ft (~69.17 miles).
    const lat0 = 0;
    const lng0 = -80;
    const widthFt = 100;
    const metersPerDegLng = 111320;
    const dLng = (widthFt * 0.3048) / metersPerDegLng;

    const line: Feature<LineString> = {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: [
          [lng0, lat0],
          [lng0 + dLng, lat0],
        ],
      },
    };

    const result = calculateMeasurements(line);
    expect(result.measurement_type).toBe("length");
    const error = Math.abs((result.length_ft as number) - widthFt) / widthFt;
    expect(error).toBeLessThan(0.01);
  });

  it("counts a point marker as a single unit", () => {
    const point: Feature<Point> = {
      type: "Feature",
      properties: {},
      geometry: { type: "Point", coordinates: [-80.8431, 35.2271] },
    };
    const result = calculateMeasurements(point);
    expect(result.measurement_type).toBe("count");
    expect(result.point_count).toBe(1);
  });
});

describe("areaDeltaPercent", () => {
  it("is ~0 for an identical shape", () => {
    const rect = buildReferenceRectangle(35.2271, -80.8431, 100, 50);
    expect(areaDeltaPercent(rect, rect)).toBeLessThan(0.0001);
  });

  it("detects a >2% change when cleanup would meaningfully alter area", () => {
    const original = buildReferenceRectangle(35.2271, -80.8431, 100, 50);
    const shrunk = buildReferenceRectangle(35.2271, -80.8431, 90, 50); // ~10% smaller
    expect(areaDeltaPercent(original, shrunk)).toBeGreaterThan(0.02);
  });
});
