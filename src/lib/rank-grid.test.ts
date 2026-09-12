import { describe, expect, it } from "vitest";

import {
  BANDS,
  DEFAULT_GRID_SIZE,
  UNRANKED_PENALTY,
  averageRank,
  bandCounts,
  buildGrid,
  gridSpanMiles,
  movement,
  packShare,
  rankBand,
  rankLabel,
  weakSpotsNearBase,
  type ScanPoint,
} from "@/lib/rank-grid";

const base = { lat: 39.5359, lng: -76.3483 }; // Bel Air, MD

function point(rank: number | null, lat = base.lat, lng = base.lng): ScanPoint {
  return { row: 0, col: 0, lat, lng, rank };
}

describe("building the grid", () => {
  it("makes one point per cell", () => {
    expect(buildGrid(base, 7, 1)).toHaveLength(49);
    expect(buildGrid(base, 3, 1)).toHaveLength(9);
  });

  it("puts a point exactly on the business", () => {
    // Odd sizes only, so the middle cell is the yard itself.
    const middle = buildGrid(base, 7, 1).find((p) => p.row === 3 && p.col === 3)!;
    expect(middle.lat).toBeCloseTo(base.lat, 10);
    expect(middle.lng).toBeCloseTo(base.lng, 10);
  });

  it("puts row 0 at the top of the map", () => {
    const grid = buildGrid(base, 3, 1);
    const top = grid.find((p) => p.row === 0 && p.col === 1)!;
    const bottom = grid.find((p) => p.row === 2 && p.col === 1)!;
    expect(top.lat).toBeGreaterThan(bottom.lat);
  });

  it("puts col 0 on the left", () => {
    const grid = buildGrid(base, 3, 1);
    const left = grid.find((p) => p.row === 1 && p.col === 0)!;
    const right = grid.find((p) => p.row === 1 && p.col === 2)!;
    expect(left.lng).toBeLessThan(right.lng);
  });

  it("comes out square on the ground, not square in degrees", () => {
    // A degree of longitude in Maryland is about three quarters of a degree
    // of latitude. Spacing in raw degrees would squash the grid.
    const grid = buildGrid(base, 3, 1);
    const centre = grid.find((p) => p.row === 1 && p.col === 1)!;
    const north = grid.find((p) => p.row === 0 && p.col === 1)!;
    const east = grid.find((p) => p.row === 1 && p.col === 2)!;

    const latDegrees = north.lat - centre.lat;
    const lngDegrees = east.lng - centre.lng;
    expect(lngDegrees).toBeGreaterThan(latDegrees * 1.2);

    // And both really are a mile.
    const milesNorth = latDegrees * 69;
    const milesEast = lngDegrees * 69 * Math.cos((base.lat * Math.PI) / 180);
    expect(milesNorth).toBeCloseTo(1, 6);
    expect(milesEast).toBeCloseTo(1, 6);
  });

  it("spans the distance it says it does", () => {
    expect(gridSpanMiles(7, 1)).toBe(6);
    expect(gridSpanMiles(DEFAULT_GRID_SIZE, 2)).toBe(12);
  });
});

describe("bands", () => {
  it("splits on the pack, the page, and past caring", () => {
    expect(rankBand(1)).toBe("top3");
    expect(rankBand(3)).toBe("top3");
    expect(rankBand(4)).toBe("top10");
    expect(rankBand(10)).toBe("top10");
    expect(rankBand(11)).toBe("top20");
    expect(rankBand(20)).toBe("top20");
    expect(rankBand(21)).toBe("beyond");
  });

  it("treats missing and nonsense as not found", () => {
    expect(rankBand(null)).toBe("unranked");
    expect(rankBand(0)).toBe("unranked");
    expect(rankBand(-2)).toBe("unranked");
  });

  it("gives every band a colour", () => {
    for (const band of Object.values(BANDS)) {
      expect(band.colour).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("labels a point in one or two characters", () => {
    expect(rankLabel(1)).toBe("1");
    expect(rankLabel(20)).toBe("20");
    expect(rankLabel(34)).toBe("20+");
    expect(rankLabel(null)).toBe("–");
  });
});

describe("the average", () => {
  it("averages the ranks we have", () => {
    expect(averageRank([point(2), point(4)])).toBe(3);
  });

  it("counts not-found against us instead of leaving it out", () => {
    // Three good points and forty-six nowhere must not read as an average of
    // 2.0 — the most flattering possible lie about that grid.
    const grid = [point(1), point(2), point(3), ...Array(46).fill(null).map(() => point(null))];
    const average = averageRank(grid)!;
    expect(average).toBeGreaterThan(19);
    expect(average).toBeLessThanOrEqual(UNRANKED_PENALTY);
  });

  it("caps a very deep rank so one outlier cannot swamp the grid", () => {
    expect(averageRank([point(1), point(400)])).toBe((1 + UNRANKED_PENALTY) / 2);
  });

  it("says nothing about an empty grid", () => {
    expect(averageRank([])).toBeNull();
  });
});

describe("the share of the map", () => {
  it("measures how much of it is in the pack", () => {
    expect(packShare([point(1), point(2), point(9), point(null)])).toBe(0.5);
  });

  it("is zero, not an error, on an empty grid", () => {
    expect(packShare([])).toBe(0);
  });

  it("counts every point into exactly one band", () => {
    const points = [point(1), point(5), point(15), point(40), point(null)];
    const counts = bandCounts(points);
    expect(counts).toEqual({ top3: 1, top10: 1, top20: 1, beyond: 1, unranked: 1 });
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(points.length);
  });
});

describe("movement", () => {
  it("reads positive when the ranking improves", () => {
    // Rank going down is good, and a number that goes down when things get
    // better is a number people misread.
    expect(movement([point(2)], [point(6)])).toBe(4);
  });

  it("reads negative when it slips", () => {
    expect(movement([point(8)], [point(3)])).toBe(-5);
  });

  it("says nothing without something to compare to", () => {
    expect(movement([point(2)], [])).toBeNull();
  });
});

describe("where to do something about it", () => {
  const near = { lat: base.lat + 0.01, lng: base.lng };
  const far = { lat: base.lat + 0.4, lng: base.lng };

  it("picks the bad points closest to the yard", () => {
    // Invisible eight miles out is expected. Invisible two streets away is a
    // problem with a fix.
    const spots = weakSpotsNearBase(
      [point(null, far.lat, far.lng), point(null, near.lat, near.lng)],
      base,
      5
    );
    expect(spots[0].lat).toBeCloseTo(near.lat, 6);
  });

  it("leaves the points we already win alone", () => {
    expect(weakSpotsNearBase([point(1), point(7)], base)).toEqual([]);
  });

  it("stops at the limit", () => {
    const many = Array(10).fill(null).map(() => point(null));
    expect(weakSpotsNearBase(many, base, 3)).toHaveLength(3);
  });
});
