import { describe, expect, it } from "vitest";

import { crewFor, formatMinutes, modeOf, rankZones } from "./zones";

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
