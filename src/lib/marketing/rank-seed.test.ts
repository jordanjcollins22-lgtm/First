import { describe, expect, it } from "vitest";

import { HARFORD_TOWNS, CORE_SERVICES } from "./autopilot-settings";
import { centreFor, checkedThisWeek, DEFAULT_CENTRE, missingPhrases, pickForWeek, seedPhrases, TOWN_CENTRES } from "./rank-seed";

describe("rank tracker seeding", () => {
  it("crosses every town with every service", () => {
    const phrases = seedPhrases(HARFORD_TOWNS, CORE_SERVICES);
    expect(phrases).toHaveLength(40);
    expect(phrases).toContain("lawn care Bel Air MD");
    expect(phrases).toContain("snow removal Havre de Grace MD");
  });

  it("adds only what is missing, ignoring case", () => {
    expect(missingPhrases(["lawn care Bel Air MD", "mulching Joppa MD"], ["Lawn Care Bel Air MD"])).toEqual(["mulching Joppa MD"]);
  });

  it("checks each phrase from its own town", () => {
    expect(centreFor("lawn care Havre de Grace MD")).toEqual(TOWN_CENTRES["havre de grace"]);
    expect(centreFor("landscaping Street MD")).toEqual(TOWN_CENTRES.street);
    expect(centreFor("lawn care near me")).toEqual(DEFAULT_CENTRE);
  });

  it("takes never-checked phrases first, then the longest ago", () => {
    const picked = pickForWeek(
      [
        { id: "a", lastScanAt: "2026-10-01T00:00:00Z" },
        { id: "b", lastScanAt: null },
        { id: "c", lastScanAt: "2026-09-01T00:00:00Z" },
      ],
      2
    );
    expect(picked.map((p) => p.id)).toEqual(["b", "c"]);
  });

  it("skips a phrase checked in the last six days", () => {
    const now = new Date("2026-10-13T00:00:00Z");
    expect(checkedThisWeek("2026-10-10T00:00:00Z", now)).toBe(true);
    expect(checkedThisWeek("2026-10-01T00:00:00Z", now)).toBe(false);
    expect(checkedThisWeek(null, now)).toBe(false);
  });
});
