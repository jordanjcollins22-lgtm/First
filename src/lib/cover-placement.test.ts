import { describe, expect, it } from "vitest";

import { clamp, coverPlacement, coverSlack, offsetDelta } from "@/lib/cover-placement";

const BOX = { x: 0, y: 0, width: 1080, height: 648 };
// A tall phone photograph in a wide box: overflows top and bottom.
const TALL = { w: 3024, h: 4032 };
// A panorama in the same box: wider than the box's own shape, so this is
// the one that overflows left and right. (A 4:3 photograph does not — the
// box is wider than 4:3, so its width binds and it overflows vertically.)
const WIDE = { w: 4032, h: 1512 };

describe("filling the frame", () => {
  it("always covers the box", () => {
    for (const image of [TALL, WIDE]) {
      const placed = coverPlacement(image.w, image.h, BOX);
      expect(placed.width).toBeGreaterThanOrEqual(BOX.width - 1e-6);
      expect(placed.height).toBeGreaterThanOrEqual(BOX.height - 1e-6);
    }
  });

  it("centres the crop by default", () => {
    const placed = coverPlacement(TALL.w, TALL.h, BOX);
    const overhangTop = BOX.y - placed.y;
    const overhangBottom = placed.y + placed.height - (BOX.y + BOX.height);
    expect(overhangTop).toBeCloseTo(overhangBottom, 6);
  });

  it("overflows on one axis and matches on the other", () => {
    // A photograph scaled to cover matches the tighter axis exactly.
    const slack = coverSlack(TALL.w, TALL.h, BOX.width, BOX.height);
    expect(slack.x).toBeCloseTo(0, 6);
    expect(slack.y).toBeGreaterThan(0);

    const wide = coverSlack(WIDE.w, WIDE.h, BOX.width, BOX.height);
    expect(wide.y).toBeCloseTo(0, 6);
    expect(wide.x).toBeGreaterThan(0);
  });
});

describe("nudging the crop", () => {
  it("shows the top of the photograph at -1", () => {
    const placed = coverPlacement(TALL.w, TALL.h, BOX, 0, -1);
    expect(placed.y).toBeCloseTo(BOX.y, 6);
  });

  it("shows the bottom at +1", () => {
    const placed = coverPlacement(TALL.w, TALL.h, BOX, 0, 1);
    expect(placed.y + placed.height).toBeCloseTo(BOX.y + BOX.height, 6);
  });

  it("shows the left and right edges on a wide photograph", () => {
    expect(coverPlacement(WIDE.w, WIDE.h, BOX, -1).x).toBeCloseTo(BOX.x, 6);
    const right = coverPlacement(WIDE.w, WIDE.h, BOX, 1);
    expect(right.x + right.width).toBeCloseTo(BOX.x + BOX.width, 6);
  });

  it("never leaves empty frame, however far it is pushed", () => {
    // There is no such thing as dragging past the edge of the picture.
    for (const offset of [-5, -1, 0, 1, 5, NaN]) {
      const placed = coverPlacement(TALL.w, TALL.h, BOX, offset, offset);
      expect(placed.x).toBeLessThanOrEqual(BOX.x + 1e-6);
      expect(placed.y).toBeLessThanOrEqual(BOX.y + 1e-6);
      expect(placed.x + placed.width).toBeGreaterThanOrEqual(BOX.x + BOX.width - 1e-6);
      expect(placed.y + placed.height).toBeGreaterThanOrEqual(BOX.y + BOX.height - 1e-6);
    }
  });

  it("does nothing on the axis with no room to move", () => {
    const a = coverPlacement(TALL.w, TALL.h, BOX, -1, 0);
    const b = coverPlacement(TALL.w, TALL.h, BOX, 1, 0);
    expect(a.x).toBeCloseTo(b.x, 6);
  });

  it("clamps to the ends", () => {
    expect(clamp(-3)).toBe(-1);
    expect(clamp(3)).toBe(1);
    expect(clamp(0.25)).toBe(0.25);
    expect(clamp(NaN)).toBe(0);
  });
});

describe("dragging it", () => {
  it("moves the picture the way the finger went", () => {
    // Dragging down should reveal what is above, which is a negative offset.
    expect(offsetDelta(100, 1000)).toBeLessThan(0);
    expect(offsetDelta(-100, 1000)).toBeGreaterThan(0);
  });

  it("moves a pixel of picture per pixel of finger", () => {
    // Half the slack of finger travel is the whole range from centre to end.
    const slack = 1000;
    expect(offsetDelta(slack / 2, slack)).toBeCloseTo(-1, 6);
  });

  it("does nothing when there is nothing to move", () => {
    expect(offsetDelta(100, 0)).toBe(0);
  });
});
