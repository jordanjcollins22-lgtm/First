import { describe, expect, it } from "vitest";
import type { Feature, Polygon } from "geojson";

import { clusterWorkAreasIntoZones } from "./zone-clustering";

function pointPolygon(lng: number, lat: number): Feature<Polygon> {
  const d = 0.00002;
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [lng - d, lat - d],
          [lng + d, lat - d],
          [lng + d, lat + d],
          [lng - d, lat + d],
          [lng - d, lat - d],
        ],
      ],
    },
  };
}

describe("clusterWorkAreasIntoZones", () => {
  it("groups nearby work areas into one zone and far ones into another", () => {
    const base = { lng: -80.8431, lat: 35.2271 };
    const workAreas = [
      { id: "front-1", geometry: pointPolygon(base.lng, base.lat) },
      { id: "front-2", geometry: pointPolygon(base.lng + 0.00005, base.lat) },
      // ~600ft away — a separate zone (backyard)
      { id: "back-1", geometry: pointPolygon(base.lng + 0.002, base.lat) },
    ];

    const zones = clusterWorkAreasIntoZones(workAreas);

    expect(zones.length).toBe(2);
    const sizes = zones.map((z) => z.workAreaIds.length).sort();
    expect(sizes).toEqual([1, 2]);
  });

  it("names zones sequentially A, B, C...", () => {
    const workAreas = [
      { id: "1", geometry: pointPolygon(-80.84, 35.2) },
      { id: "2", geometry: pointPolygon(-80.83, 35.2) },
      { id: "3", geometry: pointPolygon(-80.82, 35.2) },
    ];
    const zones = clusterWorkAreasIntoZones(workAreas);
    expect(zones.map((z) => z.name)).toEqual(["Zone A", "Zone B", "Zone C"]);
  });

  it("returns an empty array for no work areas", () => {
    expect(clusterWorkAreasIntoZones([])).toEqual([]);
  });
});
