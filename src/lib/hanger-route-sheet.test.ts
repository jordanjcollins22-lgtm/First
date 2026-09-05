import { describe, expect, it } from "vitest";

import {
  formatWalkDistance,
  missingForWalk,
  readyToWalk,
  routeSummary,
  walkMetres,
  walkOrder,
  type WalkableZone,
} from "@/lib/hanger-route-sheet";

/** Roughly the Bel Air neighbourhood the business already walks. */
const START = { lng: -76.33, lat: 39.55 };

function zone(over: Partial<WalkableZone> = {}): WalkableZone {
  return {
    name: "Eva Mar",
    position: 0,
    startAddress: "1628 Eva Mar Blvd, Bel Air, MD 21015",
    boundary: [
      { lng: -76.34, lat: 39.54 },
      { lng: -76.32, lat: 39.54 },
      { lng: -76.32, lat: 39.56 },
      { lng: -76.34, lat: 39.56 },
    ],
    walkPath: [START, { lng: -76.325, lat: 39.55 }],
    startPoint: START,
    parkPoint: { lng: -76.331, lat: 39.551 },
    endPoint: { lng: -76.325, lat: 39.55 },
    houseCount: 42,
    ...over,
  };
}

describe("missingForWalk", () => {
  it("says nothing is missing from a finished zone", () => {
    expect(missingForWalk(zone())).toEqual([]);
    expect(readyToWalk(zone())).toBe(true);
  });

  it("names a missing path rather than just refusing", () => {
    expect(missingForWalk(zone({ walkPath: null }))).toEqual(["a path to follow"]);
  });

  it("treats a path of one point as no path", () => {
    expect(missingForWalk(zone({ walkPath: [START] }))).toContain("a path to follow");
  });

  it("treats a two-point boundary as no boundary", () => {
    const missing = missingForWalk(zone({ boundary: [START, { lng: -76.32, lat: 39.55 }] }));
    expect(missing).toContain("a boundary to stay inside");
  });

  it("wants the starting address in words, not only a point", () => {
    expect(missingForWalk(zone({ startAddress: "   " }))).toEqual(["a starting address"]);
  });

  it("does not insist on parking, because a dense street has none", () => {
    expect(missingForWalk(zone({ parkPoint: null }))).toEqual([]);
  });

  it("does not insist on an end point, because a loop ends where it started", () => {
    expect(missingForWalk(zone({ endPoint: null }))).toEqual([]);
  });

  it("lists everything missing at once, so it is fixed in one pass", () => {
    const bare = zone({ boundary: null, walkPath: null, startPoint: null, startAddress: null });
    expect(missingForWalk(bare)).toHaveLength(4);
  });
});

describe("walkOrder", () => {
  it("numbers zones by where they fall in the walk", () => {
    const ordered = walkOrder([{ position: 2 }, { position: 0 }, { position: 1 }]);
    expect(ordered.map((entry) => entry.number)).toEqual([1, 2, 3]);
    expect(ordered.map((entry) => entry.zone.position)).toEqual([0, 1, 2]);
  });

  it("renumbers rather than producing two Zone 3s", () => {
    // A zone inserted into the middle of a route.
    const ordered = walkOrder([{ position: 0 }, { position: 5 }, { position: 5 }]);
    expect(ordered.map((entry) => entry.number)).toEqual([1, 2, 3]);
  });

  it("leaves the caller's array alone", () => {
    const zones = [{ position: 2 }, { position: 0 }];
    walkOrder(zones);
    expect(zones[0].position).toBe(2);
  });

  it("is empty for a route with no zones", () => {
    expect(walkOrder([])).toEqual([]);
  });
});

describe("walkMetres", () => {
  it("follows the line rather than the boundary", () => {
    // Two points about 430m apart at this latitude.
    const metres = walkMetres([START, { lng: -76.325, lat: 39.55 }]);
    expect(metres).toBeGreaterThan(300);
    expect(metres).toBeLessThan(600);
  });

  it("adds every leg of a path that doubles back", () => {
    const there = walkMetres([START, { lng: -76.325, lat: 39.55 }]);
    const andBack = walkMetres([START, { lng: -76.325, lat: 39.55 }, START]);
    expect(andBack).toBeCloseTo(there * 2, 0);
  });

  it("is nothing for a path that was never drawn", () => {
    expect(walkMetres(null)).toBe(0);
    expect(walkMetres([START])).toBe(0);
  });
});

describe("formatWalkDistance", () => {
  it("speaks in miles, because that is a decision about shoes", () => {
    expect(formatWalkDistance(1609.344 * 2.4)).toBe("2.4 miles");
  });

  it("does not pretend to precision under a tenth of a mile", () => {
    expect(formatWalkDistance(50)).toBe("Under 0.1 miles");
  });

  it("says so when there is no path", () => {
    expect(formatWalkDistance(0)).toBe("No path drawn");
  });
});

describe("routeSummary", () => {
  it("counts only zones somebody could actually walk today", () => {
    const summary = routeSummary([
      zone({ name: "Eva Mar", houseCount: 42 }),
      zone({ name: "Tollgate", houseCount: 30, walkPath: null }),
    ]);
    expect(summary.zones).toBe(2);
    expect(summary.ready).toBe(1);
    // The unwalkable zone's 30 houses are not a promise the route can keep.
    expect(summary.houses).toBe(42);
  });

  it("says which zone is short of what", () => {
    const summary = routeSummary([zone({ name: "Tollgate", walkPath: null, startPoint: null })]);
    expect(summary.blocked).toEqual([
      { name: "Tollgate", missing: ["a path to follow", "a starting point"] },
    ]);
  });

  it("has nothing blocked when every zone is finished", () => {
    expect(routeSummary([zone(), zone({ name: "Second" })]).blocked).toEqual([]);
  });

  it("is empty for a route with no zones", () => {
    expect(routeSummary([])).toEqual({ zones: 0, ready: 0, houses: 0, metres: 0, blocked: [] });
  });
});
