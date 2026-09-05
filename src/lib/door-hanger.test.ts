import { describe, expect, it } from "vitest";

import {
  HANGER_HEIGHT_IN,
  HANGER_WIDTH_IN,
  HOLE_DIAMETER_IN,
  SHEET_WIDTH_IN,
  backHalfFor,
  backSheetOrder,
  dieLine,
  emptySides,
  hangersPerSheet,
  hasBack,
  isFilled,
  safeTopIn,
  sheetsNeeded,
  slotAt,
  type HangerFace,
  type HangerSlot,
} from "@/lib/door-hanger";

function slot(
  side: HangerSlot["side"],
  imagePath: string | null = "art.png",
  face: HangerFace = "front"
): HangerSlot {
  return { side, face, imagePath, label: null };
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

  it("runs the cut sideways out of the hole to the left edge", () => {
    // Out to the side, not up: the hanger goes onto the handle from the side
    // rather than being posted down over it.
    expect(line.slitStart).toBe(0);
    expect(line.slitEnd).toBeGreaterThan(line.slitStart);
    expect(line.slitEnd).toBeLessThan(line.holeCentreX);
  });

  it("meets the hole rather than stopping short of it or crossing it", () => {
    // Short of it and the handle cannot get in; across it and the cut is
    // drawn over the hole it is supposed to open into.
    expect(line.slitEnd).toBeCloseTo(line.holeCentreX - line.holeSize / 2, 10);
  });

  it("runs level with the hole", () => {
    // A cut that meets the hole anywhere else does not open into it.
    expect(line.slitY).toBe(line.holeCentreY);
  });

  it("mirrors the cut on the back, because the printer flips the paper", () => {
    const back = dieLine("back");
    expect(back.slitStart).toBe(1);
    expect(back.slitEnd).toBeCloseTo(line.holeCentreX + line.holeSize / 2, 10);
    // Same hole, same place — only the cut changes side.
    expect(back.holeCentreX).toBe(line.holeCentreX);
    expect(back.holeCentreY).toBe(line.holeCentreY);
    expect(back.holeSize).toBe(line.holeSize);
    expect(back.slitY).toBe(line.slitY);
  });

  it("puts front and back cuts on top of each other once flipped", () => {
    // Flipping the back left-to-right must land its cut where the front's is.
    const back = dieLine("back");
    expect(1 - back.slitStart).toBeCloseTo(line.slitStart, 10);
    expect(1 - back.slitEnd).toBeCloseTo(line.slitEnd, 10);
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

describe("the back of the sheet", () => {
  it("swaps the halves over", () => {
    // A duplex printer flips left to right, so the left hanger's back comes
    // out on the right-hand half.
    expect(backHalfFor("left")).toBe("right");
    expect(backHalfFor("right")).toBe("left");
    expect(backSheetOrder()).toEqual(["right", "left"]);
  });

  it("keeps a front and a back apart on the same half", () => {
    const slots = [slot("left", "front.png", "front"), slot("left", "back.png", "back")];
    expect(slotAt(slots, "left", "front")?.imagePath).toBe("front.png");
    expect(slotAt(slots, "left", "back")?.imagePath).toBe("back.png");
  });

  it("only prints a back when there is something on it", () => {
    expect(hasBack([slot("left")])).toBe(false);
    expect(hasBack([slot("left", "art.png", "back")])).toBe(true);
  });

  it("counts hangers off the front, never off the back", () => {
    // A back with no front is not a hanger.
    expect(hangersPerSheet([slot("left", "art.png", "back")])).toBe(0);
    expect(hangersPerSheet([slot("left"), slot("left", "art.png", "back")])).toBe(1);
  });

  it("reports empty halves per face", () => {
    expect(emptySides([slot("left")], "front")).toEqual(["right"]);
    expect(emptySides([slot("left")], "back")).toEqual(["left", "right"]);
  });
});
