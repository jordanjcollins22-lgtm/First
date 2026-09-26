import { describe, expect, it } from "vitest";

import { courtTitle, rankCourts, scoreCourt, topReasons, type CourtStats } from "./court-score";

function court(over: Partial<CourtStats> = {}): CourtStats {
  return {
    id: "c1",
    street: "BROOK HILL CT",
    zip: "21014",
    locality: "BEL AIR",
    houseCount: 12,
    lat: 39.5,
    lng: -76.3,
    spreadM: 55,
    assessedMedian: 650_000,
    ownerOccupied: 12,
    ownershipKnown: 12,
    detached: 12,
    townhouse: 0,
    condo: 0,
    clients: 3,
    touched: 3,
    jobsDone: 1,
    shopKm: 6,
    ...over,
  };
}

describe("scoreCourt", () => {
  it("gives a full hundred to the ideal court", () => {
    const s = scoreCourt(court());
    expect(s.score).toBe(100);
    expect(s.verdict).toBe("prime");
    expect(s.skip).toBe(false);
  });

  it("sinks a court that is mostly condos", () => {
    const s = scoreCourt(court({ detached: 2, townhouse: 0, condo: 40, houseCount: 42 }));
    expect(s.skip).toBe(true);
    expect(s.score).toBeLessThan(35);
    expect(s.parts.find((p) => p.key === "type")?.why).toBe("mostly condos or apartments");
  });

  it("gives middling points when the county knows nothing", () => {
    const s = scoreCourt(
      court({ assessedMedian: null, spreadM: null, ownerOccupied: 0, ownershipKnown: 0, detached: 0, townhouse: 0, condo: 0, clients: 0, touched: 0, jobsDone: 0, shopKm: null })
    );
    expect(s.parts.map((p) => p.points)).toEqual([8, 15, 7, 5, 5, 0, 5]);
    expect(s.verdict).toBe("fair");
  });

  it("scores a cheap, far, loose loop as weak", () => {
    const s = scoreCourt(court({ assessedMedian: 200_000, spreadM: 300, houseCount: 90, clients: 0, touched: 0, jobsDone: 0, shopKm: 30, ownerOccupied: 3 }));
    expect(s.verdict).toBe("weak");
  });

  it("says why in words", () => {
    const s = scoreCourt(court({ clients: 1, jobsDone: 0 }));
    expect(s.parts.find((p) => p.key === "foothold")?.why).toBe("1 client already here");
    expect(s.parts.find((p) => p.key === "value")?.why).toBe("assessed around $650k");
    expect(topReasons(s.parts, 2)).toHaveLength(2);
  });
});

describe("rankCourts", () => {
  it("orders best first and numbers them", () => {
    const ranked = rankCourts([court({ id: "weak", assessedMedian: 200_000, clients: 0, touched: 0, jobsDone: 0 }), court({ id: "best" })]);
    expect(ranked.map((c) => c.id)).toEqual(["best", "weak"]);
    expect(ranked.map((c) => c.rank)).toEqual([1, 2]);
  });
});

describe("courtTitle", () => {
  it("reads like a person wrote it", () => {
    expect(courtTitle({ street: "FALLSTON VW CT", locality: "FALLSTON" })).toBe("Fallston Vw Ct, Fallston");
    expect(courtTitle({ street: "GLEN GATE CT", locality: null })).toBe("Glen Gate Ct");
  });
});
