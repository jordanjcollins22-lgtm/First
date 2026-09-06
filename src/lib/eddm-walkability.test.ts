import { describe, expect, it } from "vitest";

import { mainRoadVerdict, routeTypeVerdict, samplePoints, walkVerdict } from "@/lib/eddm-walkability";

describe("routeTypeVerdict", () => {
  it("walks city routes and not the driven kinds", () => {
    expect(routeTypeVerdict("C").walkability).toBe("walkable");
    expect(routeTypeVerdict("R")).toMatchObject({ walkability: "hard" });
    expect(routeTypeVerdict("R").reason).toMatch(/Rural/);
    expect(routeTypeVerdict("H").walkability).toBe("hard");
    expect(routeTypeVerdict("B").reason).toMatch(/no doors/);
    expect(routeTypeVerdict(null).walkability).toBe("unknown");
  });
});

describe("mainRoadVerdict", () => {
  it("lets a route of streets through and stops one with a highway in it", () => {
    expect(mainRoadVerdict([{ class: "street", name: "Oak Ln" }, { class: "tertiary", name: "Moores Mill Rd" }]).walkability).toBe("walkable");
    const verdict = mainRoadVerdict([{ class: "street", name: "Oak Ln" }, { class: "primary", name: "Bel Air Rd" }]);
    expect(verdict.walkability).toBe("hard");
    expect(verdict.reason).toContain("Bel Air Rd");
  });

  it("names the class when the road has no name", () => {
    expect(mainRoadVerdict([{ class: "trunk_link", name: null }]).reason).toMatch(/trunk road/);
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
  it("does not bother checking roads on a route USPS drives", () => {
    expect(walkVerdict("R", null).walkability).toBe("hard");
  });

  it("is unknown for a city route whose roads have not been checked", () => {
    expect(walkVerdict("C", null)).toMatchObject({ walkability: "unknown" });
  });

  it("decides a city route by its roads", () => {
    expect(walkVerdict("C", []).walkability).toBe("walkable");
    expect(walkVerdict("C", [{ class: "secondary", name: "Churchville Rd" }]).walkability).toBe("hard");
  });
});
