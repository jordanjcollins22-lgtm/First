import { describe, expect, it } from "vitest";

import {
  CLOSE_POINT_RADIUS,
  addDrawingPoint,
  canClose,
  closeLabel,
  drawingHint,
  isDuplicateTap,
  shouldClose,
} from "./zone-drawing";

const square = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
];

describe("canClose", () => {
  it("needs three corners before there is an area", () => {
    expect(canClose([])).toBe(false);
    expect(canClose(square.slice(0, 2))).toBe(false);
    expect(canClose(square)).toBe(true);
  });
});

describe("shouldClose", () => {
  it("closes on a tap back at the first point", () => {
    expect(shouldClose(square, { x: 0, y: 0 })).toBe(true);
  });

  it("forgives a tap that lands a little off, which is the whole problem", () => {
    expect(shouldClose(square, { x: 12, y: 9 })).toBe(true);
  });

  it("does not close on a tap somewhere else", () => {
    expect(shouldClose(square, { x: 60, y: 60 })).toBe(false);
  });

  it("does not close a shape that is not one yet", () => {
    expect(shouldClose(square.slice(0, 2), { x: 0, y: 0 })).toBe(false);
  });

  it("is forgiving enough for a finger", () => {
    expect(CLOSE_POINT_RADIUS).toBeGreaterThanOrEqual(20);
  });
});

describe("isDuplicateTap", () => {
  it("treats a tap on the point just placed as the same tap", () => {
    expect(isDuplicateTap(square, { x: 102, y: 101 })).toBe(true);
  });

  it("allows a genuine next corner", () => {
    expect(isDuplicateTap(square, { x: 0, y: 100 })).toBe(false);
  });

  it("allows the first point of all", () => {
    expect(isDuplicateTap([], { x: 5, y: 5 })).toBe(false);
  });

  it("does not block a narrow strip coming back near an earlier corner", () => {
    // Only the last point is checked, on purpose.
    expect(isDuplicateTap(square, { x: 2, y: 1 })).toBe(false);
  });
});

describe("addDrawingPoint", () => {
  it("adds a real corner", () => {
    expect(addDrawingPoint(square, { x: 0, y: 100 })).toHaveLength(4);
  });

  it("swallows the stray double tap rather than stacking a point", () => {
    expect(addDrawingPoint(square, { x: 101, y: 100 })).toBe(square);
  });
});

describe("drawingHint", () => {
  it("says what to do before anything is tapped", () => {
    expect(drawingHint("zone", 0)).toMatch(/tap each corner/i);
  });

  it("counts up to a closable shape", () => {
    expect(drawingHint("zone", 2)).toMatch(/2 of 3/);
  });

  it("leads with the button once closing is possible", () => {
    expect(drawingHint("zone", 3)).toMatch(/Close area/);
    expect(drawingHint("property-line", 4)).toMatch(/Close property line/);
  });
});

describe("closeLabel", () => {
  it("names the thing being closed", () => {
    expect(closeLabel("zone")).toBe("Close area");
    expect(closeLabel("property-line")).toBe("Close property line");
  });
});
