import { describe, expect, it } from "vitest";

import {
  CELL_DEGREES,
  densityCells,
  intensityOf,
  rankCells,
  valuePerAddress,
  type DensityPoint,
} from "@/lib/area-density";

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

describe("rankCells", () => {
  const cells = densityCells([
    // Dense, no money — a street of small lots.
    ...Array.from({ length: 40 }, (_, i) => point({ lat: 39.5 + i * 0.0001, area: "Aberdeen" })),
    // Sparse, all the money — three acres apiece.
    ...Array.from({ length: 4 }, (_, i) =>
      point({ lat: 39.7 + i * 0.0001, lng: -76.4, collected: 20000, jobs: 1, area: "Monkton" })
    ),
  ]);

  it("ranks by addresses in count mode", () => {
    expect(rankCells(cells, "count")[0].area).toBe("Aberdeen");
  });

  it("ranks by money in paid mode, which is a different answer", () => {
    // The whole reason for two modes: the densest part of a county is usually
    // the part with the smallest lots.
    expect(rankCells(cells, "paid")[0].area).toBe("Monkton");
  });

  it("drops cells that never earned rather than ranking them last", () => {
    // A top ten by money that is eight zeroes is not a ranking.
    const paid = rankCells(cells, "paid");
    expect(paid.every((c) => c.collected > 0)).toBe(true);
  });

  it("breaks a tie on addresses by which has earned", () => {
    const tied = densityCells([
      point({ lat: 39.5, area: "A" }),
      point({ lat: 39.6, collected: 5000, area: "B" }),
    ]);
    expect(rankCells(tied, "count")[0].area).toBe("B");
  });

  it("returns at most the limit asked for", () => {
    expect(rankCells(cells, "count", 1)).toHaveLength(1);
  });

  it("has nothing to rank when there is nothing", () => {
    expect(rankCells([], "count")).toEqual([]);
    expect(rankCells([], "paid")).toEqual([]);
  });
});

describe("intensityOf", () => {
  const cells = densityCells([
    ...Array.from({ length: 10 }, (_, i) => point({ lat: 39.5 + i * 0.0001 })),
    point({ lat: 39.6 }),
  ]);

  it("scales against the strongest cell rather than a fixed number", () => {
    // The numbers differ by orders of magnitude between a book of two hundred
    // and one of ninety thousand; a fixed scale renders one all one colour.
    const ranked = rankCells(cells, "count");
    expect(intensityOf(ranked[0], cells, "count")).toBe(1);
    expect(intensityOf(ranked[1], cells, "count")).toBeCloseTo(0.1);
  });

  it("is zero when nothing has any weight at all", () => {
    const none = densityCells([point()]);
    expect(intensityOf(none[0], none, "paid")).toBe(0);
  });
});

describe("valuePerAddress", () => {
  it("says whether a dense area is dense with work or just with houses", () => {
    const cells = densityCells([
      point({ collected: 8000, jobs: 1 }),
      point({ lat: 39.501 }),
      point({ lat: 39.502 }),
      point({ lat: 39.503 }),
    ]);
    expect(valuePerAddress(cells[0])).toBe(2000);
  });

  it("is zero rather than a division by zero", () => {
    expect(
      valuePerAddress({ key: "k", bounds: [0, 0, 1, 1], lat: 0, lng: 0, count: 0, collected: 0, jobs: 0, area: "x" })
    ).toBe(0);
  });
});
