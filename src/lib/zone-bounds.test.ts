import { describe, expect, it } from "vitest";

import { fitInsideLine, hasPropertyLine, insideLine, shapeInsideLine } from "@/lib/zone-bounds";

const square = (x: number, y: number, w: number, h = w) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

// A 200 x 200 lot.
const LOT = square(100, 100, 200);
// The same lot with a notch cut out of the top right: an L.
const L_LOT = [
  { x: 100, y: 100 },
  { x: 200, y: 100 },
  { x: 200, y: 200 },
  { x: 300, y: 200 },
  { x: 300, y: 300 },
  { x: 100, y: 300 },
];

describe("zone bounds", () => {
  it("has no rule until the line encloses something", () => {
    expect(hasPropertyLine([])).toBe(false);
    expect(hasPropertyLine([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(false);
    expect(insideLine({ x: 9999, y: 9999 }, [])).toBe(true);
    expect(shapeInsideLine(square(9000, 9000, 10), [])).toBe(true);
  });

  it("tells a tap inside the line from one outside it", () => {
    expect(insideLine({ x: 150, y: 150 }, LOT)).toBe(true);
    expect(insideLine({ x: 50, y: 150 }, LOT)).toBe(false);
    expect(insideLine({ x: 350, y: 350 }, LOT)).toBe(false);
  });

  it("counts a tap right on the line as inside", () => {
    expect(insideLine({ x: 100, y: 180 }, LOT)).toBe(true);
    expect(insideLine({ x: 300, y: 300 }, LOT)).toBe(true);
  });

  it("knows the notch of an L-shaped lot is outside", () => {
    expect(insideLine({ x: 250, y: 150 }, L_LOT)).toBe(false);
    expect(insideLine({ x: 150, y: 150 }, L_LOT)).toBe(true);
  });

  it("refuses a shape with one corner over the line", () => {
    expect(shapeInsideLine(square(150, 150, 40), LOT)).toBe(true);
    expect(shapeInsideLine(square(280, 150, 40), LOT)).toBe(false);
  });

  it("refuses a shape whose side cuts across the notch even with every corner in", () => {
    // All three corners are in the lot, but the long side clips the corner
    // of the notch on its way from the top left to the bottom right.
    const across = [
      { x: 150, y: 150 },
      { x: 280, y: 250 },
      { x: 150, y: 250 },
    ];
    expect(across.every((p) => insideLine(p, L_LOT))).toBe(true);
    expect(shapeInsideLine(across, L_LOT)).toBe(false);
  });

  it("leaves a measured area alone when it is already inside", () => {
    const shape = square(150, 150, 40);
    expect(fitInsideLine(shape, { x: 170, y: 170 }, LOT)).toEqual({ points: shape, moved: false, shrunk: false });
  });

  it("slides an area tapped near the fence in, at its full size", () => {
    // 40 across, tapped 5 in from the left line: half of it hangs over.
    const anchor = { x: 105, y: 200 };
    const shape = square(85, 180, 40);
    const fitted = fitInsideLine(shape, anchor, LOT);
    expect(fitted.moved).toBe(true);
    expect(fitted.shrunk).toBe(false);
    expect(shapeInsideLine(fitted.points, LOT)).toBe(true);
    // Same size.
    const xs = fitted.points.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(40, 6);
    // Still over the tap.
    expect(insideLine(anchor, fitted.points)).toBe(true);
  });

  it("draws an area smaller only when it cannot fit at its size", () => {
    // 300 across on a 200 lot.
    const anchor = { x: 200, y: 200 };
    const fitted = fitInsideLine(square(50, 50, 300), anchor, LOT);
    expect(fitted.shrunk).toBe(true);
    expect(shapeInsideLine(fitted.points, LOT)).toBe(true);
    expect(insideLine(anchor, fitted.points)).toBe(true);
  });

  it("keeps an area in the leg of an L-shaped lot out of the notch", () => {
    const anchor = { x: 260, y: 210 };
    const fitted = fitInsideLine(square(240, 190, 40), anchor, L_LOT);
    expect(shapeInsideLine(fitted.points, L_LOT)).toBe(true);
    expect(fitted.shrunk).toBe(false);
  });
});
