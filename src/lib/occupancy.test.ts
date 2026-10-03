import { describe, expect, it } from "vitest";

import { occupancyBadge } from "./occupancy";

describe("occupancyBadge", () => {
  it("reads owner-occupied off the roll", () => {
    const badge = occupancyBadge({ ownerOccupied: true, reason: "Owner claims it as principal residence" });
    expect(badge.label).toBe("Owns the home");
    expect(badge.tone).toBe("good");
  });
  it("calls an absentee-owned house rented and warns about sign-off", () => {
    const badge = occupancyBadge({ ownerOccupied: false, reason: "Not the owner's principal residence", ownerName: "ACME HOLDINGS LLC" });
    expect(badge.label).toBe("Rents the home");
    expect(badge.detail).toContain("ACME HOLDINGS LLC");
    expect(badge.detail).toMatch(/sign off/);
  });
  it("says what it is still finding out", () => {
    expect(occupancyBadge({ ownerOccupied: null, reason: null }).label).toMatch(/Checking/);
    expect(occupancyBadge({ ownerOccupied: null, reason: null, noHouse: true }).label).toMatch(/Not in the county data/);
  });
  it("uses no dashes", () => {
    for (const facts of [{ ownerOccupied: true, reason: null }, { ownerOccupied: false, reason: null }, { ownerOccupied: null, reason: null }]) {
      const b = occupancyBadge(facts);
      expect(`${b.label} ${b.detail}`).not.toMatch(/[—–]/);
    }
  });
});
