import { describe, expect, it } from "vitest";

import { checkpointOf, describeBuild, routeTypeOf, scopeOf, wavePointsOf, zipsForBuild } from "./eddm-build";

describe("zipsForBuild", () => {
  it("keeps five-digit ZIPs with enough houses, biggest first", () => {
    const zips = zipsForBuild([
      { zip: "21009", n: 13228 },
      { zip: "21014", n: 18612 },
      { zip: "EN MD", n: 12 },
      { zip: "21082", n: 26 },
      { zip: "21236", n: 7 },
    ]);
    expect(zips).toEqual(["21014", "21009", "21082"]);
  });
});

describe("routeTypeOf", () => {
  it("reads USPS's TYPE attribute", () => {
    expect(routeTypeOf({ routeId: "C002", attributes: { TYPE: "C" } })).toBe("C");
    expect(routeTypeOf({ routeId: "R004", attributes: { TYPE: "R" } })).toBe("R");
  });
  it("falls back to the route id's letter", () => {
    expect(routeTypeOf({ routeId: "H001", attributes: {} })).toBe("H");
    expect(routeTypeOf({ routeId: "0001", attributes: {} })).toBeNull();
  });
});

describe("wavePointsOf", () => {
  it("turns a closed ring into unclosed lat/lng points", () => {
    const points = wavePointsOf({
      rings: [
        [
          [-76.3, 39.5],
          [-76.2, 39.5],
          [-76.2, 39.6],
          [-76.3, 39.5],
        ],
      ],
    });
    expect(points).toEqual([
      { lat: 39.5, lng: -76.3 },
      { lat: 39.5, lng: -76.2 },
      { lat: 39.6, lng: -76.2 },
    ]);
  });
  it("gives nothing for a route without a boundary", () => {
    expect(wavePointsOf({ rings: [] })).toBeNull();
  });
});

describe("describeBuild", () => {
  const base = { created: 12, matched: 4000, review: 30, skipped: 5, fetched: 40, last_error: null };
  it("says where a running build is", () => {
    const text = describeBuild({
      ...base,
      status: "running",
      scope: { zips: ["21014", "21009", "21015"], replaceWaves: [] },
      checkpoint: { offset: 1, attempts: 0, replaced: false, phase: "routes", zips: {} },
    });
    expect(text).toContain("1 of 3 ZIPs");
    expect(text).toContain("on 21009");
    expect(text).toContain("12 walkable routes made waves");
  });
  it("says a finished build is built", () => {
    const text = describeBuild({
      ...base,
      status: "done",
      scope: { zips: ["21014"], replaceWaves: [] },
      checkpoint: { offset: 1, attempts: 0, replaced: true, phase: "routes", zips: {} },
    });
    expect(text.startsWith("Built 1 of 1 ZIPs")).toBe(true);
  });
});

describe("scope and checkpoint parsing", () => {
  it("tolerates missing or odd values", () => {
    expect(scopeOf({ scope: null })).toEqual({ zips: [], replaceWaves: [] });
    expect(scopeOf({ scope: { zips: ["21014", 3], replaceWaves: "x" } })).toEqual({ zips: ["21014"], replaceWaves: [] });
    expect(checkpointOf({ checkpoint: {} })).toEqual({ offset: 0, attempts: 0, replaced: false, phase: "routes", zoneIndex: 0, fixQueue: [], passes: 0, zips: {} });
  });
});
