import { describe, expect, it } from "vitest";

import {
  applyOrder,
  DEFAULT_SNAP_METRES,
  orderAlongLine,
  orderIsStale,
  projectOntoSegment,
  type OrderableHouse,
} from "./route-order";

// Near enough for a county: about a mile of latitude, and a street's worth of
// longitude, around the middle of Harford.
const BASE = { lat: 39.53, lng: -76.35 };
const METRE_LAT = 1 / 110_574;
const METRE_LNG = 1 / (Math.cos((39.5 * Math.PI) / 180) * 111_320);

/** A house `east` metres east and `north` metres north of the base point. */
const at = (id: string, east: number, north: number): OrderableHouse => ({
  id,
  lat: BASE.lat + north * METRE_LAT,
  lng: BASE.lng + east * METRE_LNG,
});

describe("projecting a point onto a segment", () => {
  it("finds the foot of the perpendicular", () => {
    const p = projectOntoSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(p.t).toBeCloseTo(0.5);
    expect(p.distance).toBeCloseTo(3);
  });

  it("clamps to the segment rather than running off the end of it", () => {
    // A house past the end of the line belongs at the end of the line, not on
    // an imaginary continuation of it.
    const p = projectOntoSegment({ x: 50, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(p.t).toBe(1);
    expect(p.distance).toBeCloseTo(40);
  });

  it("copes with a segment of no length", () => {
    const p = projectOntoSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 });
    expect(p.distance).toBeCloseTo(5);
  });
});

describe("ordering houses along a drawn line", () => {
  // Five houses in a row, twenty metres apart, given out of order.
  const street: OrderableHouse[] = [at("c", 40, 0), at("a", 0, 0), at("e", 80, 0), at("b", 20, 0), at("d", 60, 0)];
  const eastward = [BASE, { lat: BASE.lat, lng: BASE.lng + 100 * METRE_LNG }];

  it("puts them in the order the line passes them", () => {
    expect(orderAlongLine(street, eastward).ordered).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("reverses when the line is drawn the other way", () => {
    const westward = [...eastward].reverse();
    expect(orderAlongLine(street, westward).ordered).toEqual(["e", "d", "c", "b", "a"]);
  });

  it("follows a line that doubles back, so up one side and down the other works", () => {
    // Two rows: the near side going east, the far side coming back west.
    const near = [at("n1", 0, 0), at("n2", 40, 0), at("n3", 80, 0)];
    const far = [at("f1", 0, 30), at("f2", 40, 30), at("f3", 80, 30)];
    const hairpin = [
      BASE,
      { lat: BASE.lat, lng: BASE.lng + 100 * METRE_LNG },
      { lat: BASE.lat + 30 * METRE_LAT, lng: BASE.lng + 100 * METRE_LNG },
      { lat: BASE.lat + 30 * METRE_LAT, lng: BASE.lng },
    ];
    expect(orderAlongLine([...near, ...far], hairpin, 25).ordered).toEqual([
      "n1",
      "n2",
      "n3",
      "f3",
      "f2",
      "f1",
    ]);
  });

  it("hands back the doors the line misses rather than guessing at them", () => {
    // A person who drew down one street and left forty doors out has either
    // changed their mind or missed a street. Only they know which.
    const stray = at("far", 40, 900);
    const result = orderAlongLine([...street, stray], eastward);
    expect(result.ordered).not.toContain("far");
    expect(result.offRoute).toEqual(["far"]);
  });

  it("says how far the furthest kept door was, so a sloppy line is visible", () => {
    const result = orderAlongLine([at("a", 0, 0), at("b", 20, 60)], eastward);
    expect(Math.round(result.furthestKeptMetres)).toBe(60);
  });

  it("keeps a door on the far side of a normal street", () => {
    // Twelve metres is across a road; the default has to tolerate that.
    expect(orderAlongLine([at("a", 10, 12)], eastward).ordered).toEqual(["a"]);
    expect(DEFAULT_SNAP_METRES).toBeGreaterThan(12);
  });

  it("orders nothing from a line that is not a line", () => {
    expect(orderAlongLine(street, [BASE]).ordered).toEqual([]);
    expect(orderAlongLine(street, [BASE]).offRoute).toHaveLength(5);
  });
});

describe("applying a hand-made order to the round as it stands", () => {
  it("walks them in the order given", () => {
    expect(applyOrder(["a", "b", "c"], ["c", "a", "b"])).toEqual(["c", "a", "b"]);
  });

  it("ignores an order entry for a door no longer on the round", () => {
    expect(applyOrder(["a", "b"], ["b", "gone", "a"])).toEqual(["b", "a"]);
  });

  it("never drops a door just because it is not in the order", () => {
    // Doors added after the line was drawn go on the end. Dropping one
    // silently is how a street gets missed.
    expect(applyOrder(["a", "b", "new"], ["b", "a"])).toEqual(["b", "a", "new"]);
  });

  it("survives a repeated id without walking it twice", () => {
    expect(applyOrder(["a", "b"], ["a", "a", "b"])).toEqual(["a", "b"]);
  });

  it("falls back to the round's own order when nothing was given", () => {
    expect(applyOrder(["a", "b", "c"], [])).toEqual(["a", "b", "c"]);
  });
});

describe("whether a hand-made order still fits the round", () => {
  it("is not stale when it covers everything on the round", () => {
    expect(orderIsStale(["a", "b"], ["b", "a"])).toBe(false);
  });

  it("is stale once a door has been added that it does not mention", () => {
    expect(orderIsStale(["a", "b", "c"], ["b", "a"])).toBe(true);
  });

  it("is not stale merely because a door came off the round", () => {
    expect(orderIsStale(["a"], ["a", "b"])).toBe(false);
  });

  it("says nothing about a round with no hand-made order at all", () => {
    expect(orderIsStale(["a", "b"], [])).toBe(false);
  });
});
