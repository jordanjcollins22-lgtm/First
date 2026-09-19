import { describe, expect, it } from "vitest";

import {
  CELL_DEGREES,
  clusterCells,
  densityCells,
  disambiguate,
  intensityOf,
  rankAreas,
  valuePerAddress,
  type DensityPoint,
} from "@/lib/area-density";

/** Cells, joined into places, the way every caller uses them. */
function areasFrom(points: DensityPoint[]) {
  return disambiguate(clusterCells(densityCells(points)));
}

function point(o: Partial<DensityPoint> = {}): DensityPoint {
  return { lat: 39.5, lng: -76.3, collected: 0, jobs: 0, area: "Bel Air", ...o };
}

describe("densityCells", () => {
  it("puts addresses close together in one cell", () => {
    const cells = densityCells([point(), point({ lat: 39.502 }), point({ lat: 39.503 })]);
    expect(cells).toHaveLength(1);
    expect(cells[0].count).toBe(3);
  });

  it("separates addresses more than a cell apart", () => {
    expect(densityCells([point(), point({ lat: 39.6 })])).toHaveLength(2);
  });

  it("puts the marker where the houses are, not on the gridline", () => {
    // The average of what is in it, so a cell with everything bunched in one
    // corner draws there rather than in the middle of an empty box.
    const cells = densityCells([point({ lat: 39.5 }), point({ lat: 39.504 })]);
    expect(cells[0].lat).toBeCloseTo(39.502);
  });

  it("adds up the money and the jobs inside it", () => {
    const cells = densityCells([
      point({ collected: 4000, jobs: 1 }),
      point({ lat: 39.501, collected: 2000, jobs: 2 }),
    ]);
    expect(cells[0].collected).toBe(6000);
    expect(cells[0].jobs).toBe(3);
  });

  it("labels a cell with whichever town most of it claims", () => {
    // Cells do not respect town boundaries, and the most common name is more
    // use than the first one or a shrug.
    const cells = densityCells([
      point({ area: "Bel Air" }),
      point({ lat: 39.501, area: "Bel Air" }),
      point({ lat: 39.502, area: "Fallston" }),
    ]);
    expect(cells[0].area).toBe("Bel Air");
  });

  it("ignores an address with no usable position", () => {
    expect(densityCells([point({ lat: Number.NaN })])).toEqual([]);
  });

  it("carries the cell's own square, for drawing a boundary", () => {
    // An outline says "these streets". A blurred dot says "somewhere around
    // here", which is not a place anybody can be sent.
    const [cell] = densityCells([point({ lat: 39.505, lng: -76.305 })]);
    const [west, south, east, north] = cell.bounds;
    expect(south).toBeLessThanOrEqual(39.505);
    expect(north).toBeGreaterThan(39.505);
    expect(west).toBeLessThanOrEqual(-76.305);
    expect(east).toBeGreaterThan(-76.305);
    expect(north - south).toBeCloseTo(CELL_DEGREES);
  });

  it("uses a cell about half a mile across", () => {
    // A cell somebody cannot walk in a session is not a decision.
    expect(CELL_DEGREES).toBeCloseTo(0.01);
  });
});

const POINTS_FOR_RANKING: DensityPoint[] = [
  // Dense, no money — a street of small lots.
  ...Array.from({ length: 40 }, (_, i) => point({ lat: 39.5 + i * 0.0001, area: "Aberdeen" })),
  // Sparse, all the money — three acres apiece.
  ...Array.from({ length: 4 }, (_, i) =>
    point({ lat: 39.7 + i * 0.0001, lng: -76.4, collected: 20000, jobs: 1, area: "Monkton" })
  ),
];

describe("clusterCells", () => {
  it("joins a town that spans several cells into one row", () => {
    // The bug this exists for: a ranked top ten reading "Bel Air, Aberdeen,
    // Bel Air, Aberdeen" looks broken even though every row is correct.
    const spread = Array.from({ length: 30 }, (_, i) =>
      point({ lat: 39.5 + i * 0.002, area: "Bel Air" })
    );
    const areas = clusterCells(densityCells(spread));
    expect(areas).toHaveLength(1);
    expect(areas[0].count).toBe(30);
    expect(areas[0].area).toBe("Bel Air");
  });

  it("joins cells that only touch at a corner", () => {
    // A neighbourhood running corner to corner across a grid line is still
    // one neighbourhood; the grid line is an artefact of the counting.
    const areas = clusterCells(densityCells([point({ lat: 39.5, lng: -76.3 }), point({ lat: 39.511, lng: -76.291 })]));
    expect(areas).toHaveLength(1);
  });

  it("keeps genuinely separate pockets apart", () => {
    const areas = clusterCells(densityCells([point({ lat: 39.5 }), point({ lat: 39.9 })]));
    expect(areas).toHaveLength(2);
  });

  it("keeps every cell it joined, so the real shape can be drawn", () => {
    // An L-shaped run of streets is not a rectangle.
    const areas = clusterCells(densityCells([point({ lat: 39.5 }), point({ lat: 39.512 })]));
    expect(areas[0].cells).toHaveLength(2);
  });

  it("adds up everything inside the joined area", () => {
    const areas = clusterCells(
      densityCells([
        point({ collected: 1000, jobs: 1 }),
        point({ lat: 39.512, collected: 2000, jobs: 1 }),
      ])
    );
    expect(areas[0]).toMatchObject({ count: 2, collected: 3000, jobs: 2 });
  });

  it("labels the joined area with whichever town holds most of it", () => {
    const areas = clusterCells(
      densityCells([
        ...Array.from({ length: 9 }, (_, i) => point({ lat: 39.5 + i * 0.0001, area: "Bel Air" })),
        point({ lat: 39.512, area: "Fallston" }),
      ])
    );
    expect(areas[0].area).toBe("Bel Air");
  });
});

describe("disambiguate", () => {
  it("tells apart two separate pockets that share a name", () => {
    // Clustering removes nearly all of these, but a town really can have two
    // unconnected patches, and printing the name twice with no way to tell
    // which is which is the thing being fixed.
    const areas = disambiguate(
      clusterCells(densityCells([point({ lat: 39.5, area: "Bel Air" }), point({ lat: 39.9, area: "Bel Air" })]))
    );
    const names = areas.map((a) => a.area).sort();
    expect(names).toEqual(["Bel Air (north)", "Bel Air (south)"]);
  });

  it("leaves a name alone when it only appears once", () => {
    const areas = disambiguate(clusterCells(densityCells([point({ area: "Bel Air" })])));
    expect(areas[0].area).toBe("Bel Air");
  });
});

describe("rankAreas", () => {

  it("never lists the same place twice", () => {
    // The whole complaint: cells are half a mile and towns are not.
    const ranked = rankAreas(areasFrom(POINTS_FOR_RANKING), "count");
    const names = ranked.map((a) => a.area);
    expect(new Set(names).size).toBe(names.length);
  });

  it("ranks by addresses in count mode", () => {
    expect(rankAreas(areasFrom(POINTS_FOR_RANKING), "count")[0].area).toBe("Aberdeen");
  });

  it("ranks by money in paid mode, which is a different answer", () => {
    // The whole reason for two modes: the densest part of a county is usually
    // the part with the smallest lots.
    expect(rankAreas(areasFrom(POINTS_FOR_RANKING), "paid")[0].area).toBe("Monkton");
  });

  it("drops cells that never earned rather than ranking them last", () => {
    // A top ten by money that is eight zeroes is not a ranking.
    const paid = rankAreas(areasFrom(POINTS_FOR_RANKING), "paid");
    expect(paid.every((c) => c.collected > 0)).toBe(true);
  });

  it("breaks a tie on addresses by which has earned", () => {
    const tied = areasFrom([
      point({ lat: 39.5, area: "A" }),
      point({ lat: 39.6, collected: 5000, area: "B" }),
    ]);
    expect(rankAreas(tied, "count")[0].area).toBe("B");
  });

  it("returns at most the limit asked for", () => {
    expect(rankAreas(areasFrom(POINTS_FOR_RANKING), "count", 1)).toHaveLength(1);
  });

  it("has nothing to rank when there is nothing", () => {
    expect(rankAreas([], "count")).toEqual([]);
    expect(rankAreas([], "paid")).toEqual([]);
  });
});

describe("intensityOf", () => {
  const areas = areasFrom([
    ...Array.from({ length: 10 }, (_, i) => point({ lat: 39.5 + i * 0.0001 })),
    point({ lat: 39.6 }),
  ]);

  it("scales against the strongest area rather than a fixed number", () => {
    // The numbers differ by orders of magnitude between a book of two hundred
    // and one of ninety thousand; a fixed scale renders one all one colour.
    const ranked = rankAreas(areas, "count");
    expect(intensityOf(ranked[0], areas, "count")).toBe(1);
    expect(intensityOf(ranked[1], areas, "count")).toBeCloseTo(0.1);
  });

  it("is zero when nothing has any weight at all", () => {
    const none = areasFrom([point()]);
    expect(intensityOf(none[0], none, "paid")).toBe(0);
  });
});

describe("valuePerAddress", () => {
  it("says whether a dense area is dense with work or just with houses", () => {
    const areas = areasFrom([
      point({ collected: 8000, jobs: 1 }),
      point({ lat: 39.501 }),
      point({ lat: 39.502 }),
      point({ lat: 39.503 }),
    ]);
    expect(valuePerAddress(areas[0])).toBe(2000);
  });

  it("is zero rather than a division by zero", () => {
    expect(valuePerAddress({ count: 0, collected: 0 })).toBe(0);
  });
});
