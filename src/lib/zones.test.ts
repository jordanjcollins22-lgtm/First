import { describe, expect, it } from "vitest";

import { crewFor, formatMinutes, modeOf, rankZones, walkRunsOf } from "./zones";

describe("zone words", () => {
  it("formats times and crews", () => {
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(220)).toBe("3 h 40 min");
    expect(formatMinutes(240)).toBe("4 h");
    expect(formatMinutes(null)).toBe("");
    expect(crewFor(520)).toBe(3);
    expect(crewFor(200)).toBe(1);
  });
  it("reads a mode or nothing", () => {
    expect(modeOf("scooter")).toBe("scooter");
    expect(modeOf("bike")).toBeNull();
  });
});

describe("rankZones", () => {
  it("puts clients first, then the walkable, then the quickest doors", () => {
    const ranked = rankZones([
      { id: "a", clients: 0, mode: "vehicle", houses: 500, minutes: 500 },
      { id: "b", clients: 2, mode: "scooter", houses: 600, minutes: 400 },
      { id: "c", clients: 2, mode: "foot", houses: 600, minutes: 600 },
      { id: "d", clients: 0, mode: "foot", houses: 900, minutes: 600 },
    ]);
    expect(ranked.map((z) => z.id)).toEqual(["c", "b", "d", "a"]);
  });
});

describe("walkRunsOf", () => {
  const a: [number, number] = [-76.3, 39.4];
  const b: [number, number] = [-76.29, 39.41];
  const c: [number, number] = [-76.2, 39.5];

  it("takes a plain line as the one run it always was", () => {
    expect(walkRunsOf([a, b])).toEqual([[a, b]]);
  });

  it("keeps the runs apart when the round breaks", () => {
    expect(walkRunsOf([[a, b], [b, c]])).toEqual([[a, b], [b, c]]);
  });

  it("drops a run of one point, which draws nothing", () => {
    expect(walkRunsOf([[a, b], [c]])).toEqual([[a, b]]);
    expect(walkRunsOf([[c]])).toBeNull();
  });

  it("is nothing at all when there is no line", () => {
    expect(walkRunsOf(null)).toBeNull();
    expect(walkRunsOf([])).toBeNull();
    expect(walkRunsOf([a])).toBeNull();
  });
});
