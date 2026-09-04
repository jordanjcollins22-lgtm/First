import { describe, expect, it } from "vitest";

import { isEmptyDesign, wouldBlank, type DesignShape } from "@/lib/design-safety";

function design(over: Partial<DesignShape> = {}): DesignShape {
  return {
    imagePath: "jobs/site.jpg",
    zoneCount: 23,
    propertyLinePoints: 0,
    houseOutlinePoints: 1,
    markCount: 0,
    ...over,
  };
}

const NOTHING: DesignShape = {
  imagePath: null,
  zoneCount: 0,
  propertyLinePoints: 0,
  houseOutlinePoints: 0,
  markCount: 0,
};

describe("isEmptyDesign", () => {
  it("is true only when there is nothing on the board at all", () => {
    expect(isEmptyDesign(NOTHING)).toBe(true);
  });

  it("is false for a design with a photo and no shapes yet", () => {
    expect(isEmptyDesign({ ...NOTHING, imagePath: "jobs/site.jpg" })).toBe(false);
  });

  it.each([
    ["a zone", { zoneCount: 1 }],
    ["a property line", { propertyLinePoints: 4 }],
    ["a house outline", { houseOutlinePoints: 1 }],
    ["a note", { markCount: 1 }],
  ])("is false when there is %s and nothing else", (_label, over) => {
    expect(isEmptyDesign({ ...NOTHING, ...over })).toBe(false);
  });
});

describe("wouldBlank", () => {
  it("catches an empty save landing on real work", () => {
    expect(wouldBlank(NOTHING, design())).toBe(true);
  });

  it("allows the first save of a job that has nothing stored yet", () => {
    // Refusing this would stop a board ever starting.
    expect(wouldBlank(NOTHING, null)).toBe(false);
  });

  it("allows an empty save over an equally empty design", () => {
    expect(wouldBlank(NOTHING, NOTHING)).toBe(false);
  });

  it("allows ordinary work to save", () => {
    expect(wouldBlank(design({ zoneCount: 24 }), design())).toBe(false);
  });

  it("allows deleting a zone, which is ordinary", () => {
    expect(wouldBlank(design({ zoneCount: 22 }), design())).toBe(false);
  });

  it("allows deleting every zone while the photo stays", () => {
    // Still not "nothing at all", so it is somebody clearing shapes rather
    // than a board that failed to load.
    expect(wouldBlank(design({ zoneCount: 0, houseOutlinePoints: 0 }), design())).toBe(false);
  });

  it("allows removing the photo while the zones stay", () => {
    expect(wouldBlank(design({ imagePath: null }), design())).toBe(false);
  });

  it("catches the real case: a design that was only ever a photo", () => {
    const photoOnly = design({ zoneCount: 0, houseOutlinePoints: 0 });
    expect(wouldBlank(NOTHING, photoOnly)).toBe(true);
  });

  it("catches a design whose only content was a walkthrough note", () => {
    expect(wouldBlank(NOTHING, { ...NOTHING, markCount: 2 })).toBe(true);
  });
});
