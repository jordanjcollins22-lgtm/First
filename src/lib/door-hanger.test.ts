import { describe, expect, it } from "vitest";

import {
  HANGER_HEIGHT_IN,
  HANGER_WIDTH_IN,
  HOLE_DIAMETER_IN,
  SHEET_WIDTH_IN,
  dieLine,
  emptySides,
  hangersPerSheet,
  isFilled,
  safeTopIn,
  sheetsNeeded,
  type HangerSlot,
} from "@/lib/door-hanger";

function slot(side: HangerSlot["side"], imagePath: string | null = "art.png"): HangerSlot {
  return { side, imagePath, label: null };
}

describe("the sheet", () => {
  it("gets two hangers out of a letter sheet with nothing left over", () => {
    expect(HANGER_WIDTH_IN * 2).toBe(SHEET_WIDTH_IN);
    expect(HANGER_HEIGHT_IN).toBe(11);
  });
});

describe("the die line", () => {
  const line = dieLine();

  it("puts the hole down the middle", () => {
    expect(line.holeCentreX).toBe(0.5);
  });

  it("keeps the hole inside the hanger", () => {
    // A hole that runs off the edge is a hanger that tears.
    expect(line.holeSize).toBeLessThan(1);
    expect(line.holeCentreX - line.holeSize / 2).toBeGreaterThan(0);
    expect(line.holeCentreX + line.holeSize / 2).toBeLessThan(1);
  });

  it("takes a lever handle, not just a round knob", () => {
    expect(HOLE_DIAMETER_IN).toBeGreaterThanOrEqual(1.5);
  });

  it("runs the slot from the top edge down into the hole", () => {
    // If the slot stops short of the hole the handle cannot get in.
    expect(line.slotTop).toBeLessThan(line.holeCentreY);
    expect(line.slotWidth).toBeLessThan(line.holeSize);
  });

  it("keeps the hole in the top third, where artwork does not go", () => {
    expect(line.holeCentreY).toBeLessThan(0.33);
  });
});

describe("what the designer is told", () => {
  it("says how much of the top is lost to the cut", () => {
    // Hole centre 2.25" down plus half of a 1.75" hole.
    expect(safeTopIn()).toBeCloseTo(3.125, 3);
  });
});

describe("what a sheet yields", () => {
  it("gets two when both sides have artwork", () => {
    expect(hangersPerSheet([slot("left"), slot("right")])).toBe(2);
  });

  it("gets one when only one side does", () => {
    // Worth knowing before five hundred sheets go through the printer.
    expect(hangersPerSheet([slot("left")])).toBe(1);
    expect(hangersPerSheet([slot("left"), slot("right", null)])).toBe(1);
  });

  it("gets none from an empty sheet", () => {
    expect(hangersPerSheet([])).toBe(0);
  });

  it("counts a side with no image as still empty", () => {
    expect(isFilled(slot("left", null))).toBe(false);
    expect(emptySides([slot("left")])).toEqual(["right"]);
    expect(emptySides([])).toEqual(["left", "right"]);
  });
});

describe("how many sheets to run", () => {
  it("halves the count when both sides are filled", () => {
    expect(sheetsNeeded(500, [slot("left"), slot("right")])).toBe(250);
  });

  it("rounds up rather than coming up short", () => {
    expect(sheetsNeeded(501, [slot("left"), slot("right")])).toBe(251);
  });

  it("needs one sheet each when only one side is filled", () => {
    expect(sheetsNeeded(500, [slot("left")])).toBe(500);
  });

  it("says nothing rather than dividing by an empty sheet", () => {
    expect(sheetsNeeded(500, [])).toBeNull();
    expect(sheetsNeeded(0, [slot("left")])).toBeNull();
  });
});
