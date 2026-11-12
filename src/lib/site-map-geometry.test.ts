import { describe, expect, it } from "vitest";
import { drawnSize, looksResized, markerPoint, spreadMarkers } from "./site-map-geometry";

// A satellite photo fetched at 1280 and served @2x, on a 1000x800 board.
const NATURAL = { w: 2560, h: 2560 };
const TRANSFORM = { scale: 0.5, canvasWidth: 1000, canvasHeight: 800 };

describe("drawnSize", () => {
  it("draws the photo at the size the saved scale describes", () => {
    expect(drawnSize(NATURAL, TRANSFORM)).toEqual({ width: 1280, height: 1280 });
  });
});

describe("looksResized", () => {
  it("passes the photo the transform was saved against", () => {
    expect(looksResized(NATURAL, TRANSFORM)).toBe(false);
  });

  it("catches a resized copy standing in for the original", () => {
    // The actual bug: asking storage for a 1280-wide copy halved the natural
    // width, so the photo drew at half size inside a fixed viewBox and the
    // map came up at the wrong zoom with the zones off the ground.
    const halved = { w: 1280, h: 1280 };
    expect(drawnSize(halved, TRANSFORM).width).toBe(640);
    expect(looksResized(halved, TRANSFORM)).toBe(true);
  });

  it("does not cry wolf over a design sitting exactly on the floor", () => {
    // Saved at the smallest scale that still covers. Floating point should
    // not turn that into an alarm.
    const exact = { w: 1000, h: 800 };
    expect(looksResized(exact, { scale: 1, canvasWidth: 1000, canvasHeight: 800 })).toBe(false);
  });

  it("catches a photo too short as well as too narrow", () => {
    expect(looksResized({ w: 4000, h: 900 }, { scale: 0.5, canvasWidth: 1000, canvasHeight: 800 })).toBe(
      true
    );
  });
});

describe("markerPoint", () => {
  it("puts the marker in the middle of a square", () => {
    expect(markerPoint([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }])).toEqual({ x: 5, y: 5 });
  });
  it("weights by area, not by corners", () => {
    // An L: the big arm pulls the marker toward it.
    const p = markerPoint([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 30 }, { x: 0, y: 30 }])!;
    expect(p.x).toBeCloseTo(11, 0);
    expect(p.y).toBeCloseTo(11, 0);
  });
  it("uses the average for a line", () => {
    expect(markerPoint([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toEqual({ x: 5, y: 0 });
  });
  it("has nothing to place without points", () => {
    expect(markerPoint([])).toBeNull();
  });
});

describe("spreadMarkers", () => {
  it("moves a marker off one already there", () => {
    const [a, b] = spreadMarkers([{ x: 10, y: 10 }, { x: 10, y: 10 }], 5);
    expect(a).toEqual({ x: 10, y: 10 });
    expect(Math.hypot(b!.x - a!.x, b!.y - a!.y)).toBeGreaterThanOrEqual(5 - 1e-9);
  });
  it("leaves markers that are already apart where they are", () => {
    expect(spreadMarkers([{ x: 0, y: 0 }, { x: 20, y: 0 }], 5)).toEqual([{ x: 0, y: 0 }, { x: 20, y: 0 }]);
  });
  it("keeps a missing marker missing", () => {
    expect(spreadMarkers([null, { x: 1, y: 1 }], 5)).toEqual([null, { x: 1, y: 1 }]);
  });
});
