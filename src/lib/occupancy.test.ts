import { describe, expect, it } from "vitest";

import { occupancyBadge } from "./occupancy";

describe("occupancyBadge", () => {
  it("takes the client's word over the roll", () => {
    const badge = occupancyBadge({ told: "renter", rollOwnerOccupied: true, rollReason: "Owner claims it as principal residence" });
    expect(badge.label).toBe("Rents the home");
    expect(badge.source).toBe("client");
  });
  it("reads the roll when nobody asked", () => {
    expect(occupancyBadge({ told: null, rollOwnerOccupied: true, rollReason: null }).label).toBe("Owns the home");
    const likely = occupancyBadge({ told: null, rollOwnerOccupied: false, rollReason: "Not the owner's principal residence" });
    expect(likely.label).toBe("Likely rents");
    expect(likely.detail).toContain("Worth asking");
  });
  it("says so when nothing is known", () => {
    const badge = occupancyBadge({ told: null, rollOwnerOccupied: null, rollReason: null });
    expect(badge.label).toBe("Own or rent? Not known");
    expect(badge.source).toBe("none");
  });
});
