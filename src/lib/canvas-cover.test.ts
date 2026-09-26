import { describe, expect, it } from "vitest";

import {
  boardDiagonal,
  coverScale,
  coversAtEveryAngle,
  visibleWidthFeet,
  zoomAdjustmentFor,
} from "@/lib/canvas-cover";

const BOARD_W = 1280;
const BOARD_H = 800;

describe("covering the board", () => {
  it("measures the worst case across the board", () => {
    expect(boardDiagonal(3, 4)).toBe(5);
    expect(boardDiagonal(BOARD_W, BOARD_H)).toBeCloseTo(1509.4, 1);
  });

  it("scales a photo until its short side reaches the diagonal", () => {
    const scale = coverScale(1280, 1060, BOARD_W, BOARD_H);
    expect(1060 * scale).toBeCloseTo(boardDiagonal(BOARD_W, BOARD_H), 6);
  });

  it("leaves no corner uncovered at any angle", () => {
    const scale = coverScale(1280, 1060, BOARD_W, BOARD_H);
    expect(coversAtEveryAngle(1280, 1060, BOARD_W, BOARD_H, scale)).toBe(true);
  });

  it("rejects the old fit-inside scale, which is where the white came from", () => {
    // Fitting a photo inside the board leaves the corners empty as soon as
    // it turns — the thing being fixed.
    const fitScale = Math.min((BOARD_W * 0.9) / 1280, (BOARD_H * 0.9) / 1060);
    expect(coversAtEveryAngle(1280, 1060, BOARD_W, BOARD_H, fitScale)).toBe(false);
  });

  it("never shrinks a photo that already covers", () => {
    // A photo bigger than the diagonal must not be scaled back down into it.
    expect(coverScale(4000, 4000, BOARD_W, BOARD_H)).toBeGreaterThan(0);
    expect(coverScale(0, 0, BOARD_W, BOARD_H)).toBe(1);
  });

  it("handles a portrait photo by its short side", () => {
    const scale = coverScale(600, 2000, BOARD_W, BOARD_H);
    expect(600 * scale).toBeCloseTo(boardDiagonal(BOARD_W, BOARD_H), 6);
  });
});

describe("paying for the coverage", () => {
  it("backs the zoom off by the scaling", () => {
    // Twice the scale is one whole zoom level further out.
    expect(zoomAdjustmentFor(2)).toBeCloseTo(1, 6);
    expect(zoomAdjustmentFor(1.4142)).toBeCloseTo(0.5, 3);
  });

  it("does not back off when nothing was scaled", () => {
    expect(zoomAdjustmentFor(1)).toBe(0);
    expect(zoomAdjustmentFor(0.5)).toBe(0);
  });
});

describe("what the badge says", () => {
  it("reports what is on the board, not the whole photo", () => {
    // The board shows two thirds of a photo that spans 900 feet.
    const feet = visibleWidthFeet({
      canvasWidth: 1200,
      imageMapWidth: 1200,
      metresPerMapPixel: 1 / 3.28084,
      drawnWidth: 1800,
    });
    expect(feet).toBeCloseTo(800, 6);
  });

  it("matches the photo's own span when nothing is scaled", () => {
    const feet = visibleWidthFeet({
      canvasWidth: 1000,
      imageMapWidth: 1000,
      metresPerMapPixel: 1 / 3.28084,
      drawnWidth: 1000,
    });
    expect(feet).toBeCloseTo(1000, 6);
  });
});
