import { describe, expect, it } from "vitest";

import { coversAtEveryAngle } from "./canvas-cover";
import { MAP_ZOOM_MAX, MAP_ZOOM_MIN, canStepMapZoom, clampMapZoom, clampScale, distanceBetween, pinchScale, stepMapZoom, zoomBounds, zoomPercent } from "./canvas-zoom";

// The real board, and a real satellite photo: 1280 requested at @2x, with the
// Mapbox attribution strip cropped off the bottom.
const BOARD = { canvasWidth: 1280, canvasHeight: 800 };
const SATELLITE = { imageWidth: 2560, imageHeight: 2120 };

describe("zoomBounds", () => {
  it("floors at the scale that covers the board when turned", () => {
    const bounds = zoomBounds({ ...SATELLITE, ...BOARD });
    expect(
      coversAtEveryAngle(
        SATELLITE.imageWidth,
        SATELLITE.imageHeight,
        BOARD.canvasWidth,
        BOARD.canvasHeight,
        bounds.min
      )
    ).toBe(true);
  });

  it("leaves no room below the floor to put the corners back", () => {
    const bounds = zoomBounds({ ...SATELLITE, ...BOARD });
    const justUnder = bounds.min - 0.01;
    expect(
      coversAtEveryAngle(
        SATELLITE.imageWidth,
        SATELLITE.imageHeight,
        BOARD.canvasWidth,
        BOARD.canvasHeight,
        justUnder
      )
    ).toBe(false);
    // Which is exactly why clamping has to refuse it.
    expect(clampScale(justUnder, bounds)).toBe(bounds.min);
  });

  it("gives four times the floor to zoom into", () => {
    const bounds = zoomBounds({ ...SATELLITE, ...BOARD });
    expect(bounds.max / bounds.min).toBeCloseTo(4, 10);
  });

  it("copes with a portrait photo", () => {
    const bounds = zoomBounds({ imageWidth: 800, imageHeight: 2000, ...BOARD });
    expect(
      coversAtEveryAngle(800, 2000, BOARD.canvasWidth, BOARD.canvasHeight, bounds.min)
    ).toBe(true);
  });

  it("never returns a floor above its own ceiling", () => {
    for (const dims of [
      { imageWidth: 100, imageHeight: 100 },
      { imageWidth: 4000, imageHeight: 4000 },
      { imageWidth: 2560, imageHeight: 100 },
    ]) {
      const bounds = zoomBounds({ ...dims, ...BOARD });
      expect(bounds.max).toBeGreaterThanOrEqual(bounds.min);
    }
  });
});

describe("clampScale", () => {
  const bounds = { min: 0.7, max: 2.8 };

  it("holds the ends", () => {
    expect(clampScale(0.1, bounds)).toBe(0.7);
    expect(clampScale(99, bounds)).toBe(2.8);
  });

  it("leaves a value inside alone", () => {
    expect(clampScale(1.5, bounds)).toBe(1.5);
  });

  it("falls back to the floor on nonsense rather than blanking the photo", () => {
    expect(clampScale(Number.NaN, bounds)).toBe(0.7);
    expect(clampScale(Number.POSITIVE_INFINITY, bounds)).toBe(2.8);
  });
});

describe("zoomPercent", () => {
  it("reads 100% when the photo is just covering", () => {
    const bounds = zoomBounds({ ...SATELLITE, ...BOARD });
    expect(zoomPercent(bounds.min, bounds)).toBe(100);
  });

  it("reads 400% at the ceiling", () => {
    const bounds = zoomBounds({ ...SATELLITE, ...BOARD });
    expect(zoomPercent(bounds.max, bounds)).toBe(400);
  });

  it("does not divide by zero", () => {
    expect(zoomPercent(1, { min: 0, max: 0 })).toBe(100);
  });
});

describe("pinchScale", () => {
  const bounds = { min: 0.7, max: 2.8 };

  it("doubles the scale when the fingers double their gap", () => {
    expect(pinchScale({ startScale: 1, startDistance: 100, distance: 200, bounds })).toBe(2);
  });

  it("halves it when they close", () => {
    expect(pinchScale({ startScale: 2, startDistance: 200, distance: 100, bounds })).toBe(1);
  });

  it("stops at the floor rather than showing corners", () => {
    expect(pinchScale({ startScale: 1, startDistance: 200, distance: 10, bounds })).toBe(0.7);
  });

  it("stops at the ceiling", () => {
    expect(pinchScale({ startScale: 2, startDistance: 100, distance: 1000, bounds })).toBe(2.8);
  });

  it("measures from where the fingers started, so it cannot drift", () => {
    // Walking out and back must land exactly where it began. Accumulating
    // frame-to-frame ratios is what makes a pinch end up somewhere the
    // fingers never asked for.
    const start = { startScale: 1.4, startDistance: 120, bounds };
    let scale = start.startScale;
    for (const d of [130, 160, 200, 160, 130, 120]) {
      scale = pinchScale({ ...start, distance: d });
    }
    expect(scale).toBeCloseTo(1.4, 10);
  });

  it("ignores a gesture that starts with the fingers together", () => {
    expect(pinchScale({ startScale: 1.2, startDistance: 0, distance: 50, bounds })).toBe(1.2);
  });
});

describe("distanceBetween", () => {
  it("measures a 3-4-5", () => {
    expect(distanceBetween({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it("is zero for one point", () => {
    expect(distanceBetween({ x: 7, y: 7 }, { x: 7, y: 7 })).toBe(0);
  });
});

describe("stepMapZoom", () => {
  it("steps out and back in a whole zoom level at a time", () => {
    expect(stepMapZoom(18.7, -1)).toBeCloseTo(17.7, 5);
    expect(stepMapZoom(17.7, 1)).toBeCloseTo(18.7, 5);
  });

  it("reaches far enough out for a multi-acre property", () => {
    // Each level doubles the ground across the board. From the default down
    // to the floor is well over thirty times as much in each direction.
    let zoom = 18.7;
    for (let i = 0; i < 20; i += 1) zoom = stepMapZoom(zoom, -1);
    expect(zoom).toBe(MAP_ZOOM_MIN);
    expect(18.7 - MAP_ZOOM_MIN).toBeGreaterThanOrEqual(5);
  });

  it("never asks the map for something silly", () => {
    expect(stepMapZoom(MAP_ZOOM_MIN, -5)).toBe(MAP_ZOOM_MIN);
    expect(stepMapZoom(MAP_ZOOM_MAX, 5)).toBe(MAP_ZOOM_MAX);
  });

  it("is reversible in the middle of the range", () => {
    const there = stepMapZoom(18.7, -2);
    expect(stepMapZoom(there, 2)).toBeCloseTo(18.7, 5);
  });
});

describe("canStepMapZoom", () => {
  it("is false at the ends, so no dead button is offered", () => {
    expect(canStepMapZoom(MAP_ZOOM_MIN, -1)).toBe(false);
    expect(canStepMapZoom(MAP_ZOOM_MAX, 1)).toBe(false);
  });

  it("is true with room to move", () => {
    expect(canStepMapZoom(18.7, -1)).toBe(true);
    expect(canStepMapZoom(18.7, 1)).toBe(true);
  });
});

describe("clampMapZoom", () => {
  it("holds the range", () => {
    expect(clampMapZoom(99)).toBe(MAP_ZOOM_MAX);
    expect(clampMapZoom(1)).toBe(MAP_ZOOM_MIN);
    expect(clampMapZoom(Number.NaN)).toBe(MAP_ZOOM_MIN);
  });
});

describe("an uploaded photo", () => {
  // A phone photo and a board that is wider than it is tall.
  const PHOTO = { imageWidth: 4032, imageHeight: 3024, canvasWidth: 1000, canvasHeight: 800 };

  it("can be zoomed out until all of it is on the board", () => {
    // The bug: covering always crops, because a board's diagonal is longer
    // than either of its sides. With the covering scale as the floor, an
    // upload opened cropped and the slider would not go back.
    const cover = zoomBounds(PHOTO);
    const fitted = zoomBounds({ ...PHOTO, fitWhole: true });

    expect(fitted.min).toBeLessThan(cover.min);
    // At the fitted floor the whole photo is inside the board.
    expect(PHOTO.imageWidth * fitted.min).toBeLessThanOrEqual(PHOTO.canvasWidth + 1e-9);
    expect(PHOTO.imageHeight * fitted.min).toBeLessThanOrEqual(PHOTO.canvasHeight + 1e-9);
  });

  it("does not lose any of its zoom-in range by gaining the zoom-out", () => {
    // Dropping the floor must not quietly take away how far somebody can go
    // the other way.
    expect(zoomBounds({ ...PHOTO, fitWhole: true }).max).toBeGreaterThanOrEqual(
      zoomBounds(PHOTO).max
    );
  });

  it("lets the slider actually reach the fitted floor", () => {
    const bounds = zoomBounds({ ...PHOTO, fitWhole: true });
    expect(clampScale(0, bounds)).toBe(bounds.min);
    expect(clampScale(bounds.min, bounds)).toBe(bounds.min);
  });

  it("rescues a photo smaller than the board, which was the worst case", () => {
    // A screenshot smaller than the board had to be blown up past 1:1 just to
    // cover, so it opened enlarged and cropped with no way back.
    const small = { imageWidth: 800, imageHeight: 600, canvasWidth: 1000, canvasHeight: 800 };
    expect(zoomBounds(small).min).toBeGreaterThan(1);
    expect(zoomBounds({ ...small, fitWhole: true }).min).toBeLessThanOrEqual(1.25);
  });
});

describe("a satellite photo", () => {
  it("keeps the covering floor, so turning it never shows the board", () => {
    const map = { imageWidth: 1280, imageHeight: 1280, canvasWidth: 1000, canvasHeight: 800 };
    const bounds = zoomBounds(map);
    expect(
      coversAtEveryAngle(
        map.imageWidth,
        map.imageHeight,
        map.canvasWidth,
        map.canvasHeight,
        bounds.min
      )
    ).toBe(true);
  });
});
