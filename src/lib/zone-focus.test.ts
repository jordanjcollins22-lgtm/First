import { describe, expect, it } from "vitest";

import { focusFrame } from "@/lib/zone-focus";
import type { Point } from "@/components/canvas/types";

const W = 1000;
const H = 750;
const BOARD_ASPECT = W / H;

function box(x: number, y: number, w: number, h: number): Point[] {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

/** Every frame is within the board, whatever was asked for. */
function expectInsideBoard(frame: { x: number; y: number; width: number; height: number }) {
  expect(frame.x).toBeGreaterThanOrEqual(0);
  expect(frame.y).toBeGreaterThanOrEqual(0);
  expect(frame.x + frame.width).toBeLessThanOrEqual(W + 0.001);
  expect(frame.y + frame.height).toBeLessThanOrEqual(H + 0.001);
}

describe("focusFrame", () => {
  it("returns the whole board for a zone with no shape", () => {
    expect(focusFrame([], W, H)).toEqual({ x: 0, y: 0, width: W, height: H });
  });

  it("frames a middling zone smaller than the whole board", () => {
    const frame = focusFrame(box(400, 300, 120, 90), W, H);
    expect(frame.width).toBeLessThan(W);
    expect(frame.height).toBeLessThan(H);
    expectInsideBoard(frame);
  });

  it("keeps the board's proportions, so the map does not change shape", () => {
    // A tall thin hedge and a wide flat driveway must frame to the same shape.
    const hedge = focusFrame(box(400, 200, 20, 300), W, H);
    const drive = focusFrame(box(300, 400, 400, 30), W, H);
    expect(hedge.width / hedge.height).toBeCloseTo(BOARD_ASPECT, 5);
    expect(drive.width / drive.height).toBeCloseTo(BOARD_ASPECT, 5);
  });

  it("contains the whole shape it was given", () => {
    const points = box(400, 200, 20, 300);
    const frame = focusFrame(points, W, H);
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(frame.x);
      expect(p.x).toBeLessThanOrEqual(frame.x + frame.width);
      expect(p.y).toBeGreaterThanOrEqual(frame.y);
      expect(p.y).toBeLessThanOrEqual(frame.y + frame.height);
    }
  });

  it("will not zoom past what the photo can show", () => {
    // A zone round a single shrub. Framed tightly this is four blurred pixels.
    const frame = focusFrame(box(500, 400, 2, 2), W, H);
    expect(frame.width).toBeGreaterThanOrEqual(W / 5);
    expectInsideBoard(frame);
  });

  it("honours a caller's floor", () => {
    const tight = focusFrame(box(500, 400, 2, 2), W, H, { minSpanFraction: 1 / 10 });
    const loose = focusFrame(box(500, 400, 2, 2), W, H, { minSpanFraction: 1 / 3 });
    expect(tight.width).toBeLessThan(loose.width);
  });

  it("slides a frame back inside the board rather than shrinking it", () => {
    // A zone hard against the top left corner: where the neighbour's fence is.
    const corner = focusFrame(box(5, 5, 100, 80), W, H);
    expect(corner.x).toBe(0);
    expect(corner.y).toBe(0);
    expect(corner.width / corner.height).toBeCloseTo(BOARD_ASPECT, 5);
    expectInsideBoard(corner);
  });

  it("slides in from the far corner too", () => {
    const corner = focusFrame(box(W - 105, H - 85, 100, 80), W, H);
    expect(corner.x + corner.width).toBeCloseTo(W, 5);
    expect(corner.y + corner.height).toBeCloseTo(H, 5);
    expectInsideBoard(corner);
  });

  it("gives back the whole board when the shape covers most of it", () => {
    expect(focusFrame(box(20, 20, W - 40, H - 40), W, H)).toEqual({
      x: 0,
      y: 0,
      width: W,
      height: H,
    });
  });

  it("centres on the shape when there is room either side", () => {
    const frame = focusFrame(box(480, 355, 40, 40), W, H);
    expect(frame.x + frame.width / 2).toBeCloseTo(500, 5);
    expect(frame.y + frame.height / 2).toBeCloseTo(375, 5);
  });

  it("handles a square board", () => {
    const frame = focusFrame(box(400, 400, 50, 90), 1000, 1000);
    expect(frame.width / frame.height).toBeCloseTo(1, 5);
  });
});
