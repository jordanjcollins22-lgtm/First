import { describe, expect, it } from "vitest";

import { densityVerdict, mainRoadVerdict, needsRoadCheck, routeTypeVerdict, samplePoints, streetKm, walkVerdict } from "@/lib/eddm-walkability";

describe("routeTypeVerdict", () => {
  it("settles only the types with no doors", () => {
    expect(routeTypeVerdict("B").reason).toMatch(/no doors/);
    expect(routeTypeVerdict("G").walkability).toBe("hard");
    // USPS calls Abingdon's subdivisions rural; the doors decide, not the letter.
    expect(routeTypeVerdict("R").walkability).toBe("unknown");
    expect(routeTypeVerdict("C").walkability).toBe("unknown");
    expect(routeTypeVerdict(null).walkability).toBe("unknown");
  });
});

describe("streetKm and densityVerdict", () => {
  // Two straight kilometres of street, roughly, along a parallel of latitude.
  const twoKm: [number, number][][] = [
    [
      [-76.3, 39.5],
      [-76.3 + 2 / (111.32 * Math.cos((39.5 * Math.PI) / 180)), 39.5],
    ],
  ];
  it("measures the streets", () => {
    expect(streetKm(twoKm)).toBeCloseTo(2, 1);
    expect(streetKm([])).toBe(0);
  });
  it("walks a subdivision and drives a road of acreage lots", () => {
    // Abingdon R017: 846 deliveries on 6 km. R011: 532 on 33 km.
    expect(densityVerdict(846, 6).walkability).toBe("walkable");
    const rural = densityVerdict(532, 33.2);
    expect(rural.walkability).toBe("hard");
    expect(rural.reason).toMatch(/16 deliveries per km/);
  });
  it("does not judge without a count or a street", () => {
    expect(densityVerdict(null, 6).walkability).toBe("unknown");
    expect(densityVerdict(600, 0).walkability).toBe("unknown");
  });
  it("only sends the routes still in question to the road check", () => {
    expect(needsRoadCheck({ routeType: "R", deliveries: 846, streetKm: 6 })).toBe(true);
    expect(needsRoadCheck({ routeType: "R", deliveries: 532, streetKm: 33.2 })).toBe(false);
    expect(needsRoadCheck({ routeType: "B", deliveries: 900, streetKm: 1 })).toBe(false);
  });
});

describe("mainRoadVerdict", () => {
  const quiet = [{ class: "street", name: "Oak Ln" }];
  const main = [{ class: "street", name: "Oak Ln" }, { class: "primary", name: "Bel Air Rd" }];

  it("lets a route of streets through and stops one that runs along a highway", () => {
    expect(mainRoadVerdict([quiet, [{ class: "tertiary", name: "Moores Mill Rd" }], quiet]).walkability).toBe("walkable");
    const verdict = mainRoadVerdict([main, main, quiet, quiet]);
    expect(verdict.walkability).toBe("hard");
    expect(verdict.reason).toContain("Bel Air Rd");
    expect(verdict.reason).toContain("2 of 4 checks");
  });

  it("forgives a route that only starts from a main road", () => {
    expect(mainRoadVerdict([main, quiet, quiet, quiet, quiet, quiet]).walkability).toBe("walkable");
  });

  it("does not judge a route no check answered for", () => {
    expect(mainRoadVerdict([]).walkability).toBe("unknown");
  });

  it("names the class when the road has no name", () => {
    expect(mainRoadVerdict([[{ class: "trunk_link", name: null }]]).reason).toMatch(/trunk road/);
  });
});

describe("samplePoints", () => {
  it("spreads a few points along the whole route", () => {
    const paths: [number, number][][] = Array.from({ length: 20 }, (_, i) => [[i, 0], [i + 0.5, 0]]);
    const points = samplePoints(paths, 4);
    expect(points).toHaveLength(4);
    expect(points[0][0]).toBeLessThan(points[3][0]);
    expect(points[3][0]).toBeGreaterThan(15);
  });

  it("returns everything when there is less than asked for", () => {
    expect(samplePoints([[[0, 0], [1, 1]]], 6)).toHaveLength(2);
    expect(samplePoints([], 6)).toEqual([]);
  });
});

describe("walkVerdict", () => {
  const dense = { routeType: "R", deliveries: 800, streetKm: 7 };
  it("is hard for the driven kinds before any roads are looked at", () => {
    expect(walkVerdict({ routeType: "R", deliveries: 532, streetKm: 33.2 }, null).walkability).toBe("hard");
    expect(walkVerdict({ routeType: "B", deliveries: 900, streetKm: 1 }, null).walkability).toBe("hard");
  });
  it("waits for the roads on a dense route", () => {
    expect(walkVerdict(dense, null)).toMatchObject({ walkability: "unknown" });
  });
  it("decides a dense route by its roads", () => {
    expect(walkVerdict(dense, [[]]).walkability).toBe("walkable");
    expect(walkVerdict(dense, [[{ class: "secondary", name: "Churchville Rd" }]]).walkability).toBe("hard");
  });
});
