import { describe, expect, it } from "vitest";

import { couldLoseGround, isEmptyDesign, keepSavedGround, wouldBlank, type DesignShape, type SavedGround } from "@/lib/design-safety";

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

describe("keepSavedGround", () => {
  const geo = { lng: -76.3, lat: 39.5, zoom: 18.19, bearing: 288.8, request: 1280, kept: 1060 };
  const stored: SavedGround = {
    imagePath: "job/background-a.jpg",
    imageX: 640,
    imageY: 400,
    imageScale: 0.719,
    imageRotation: 0,
    imageRealWidthFeet: 1190.6,
    imageBearing: 288.8,
    imageGeo: geo,
    imageUploaded: false,
    propertyLine: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }],
    houseOutline: [{ x: 640, y: 400 }],
  };
  // What a board sends before the saved photo has loaded onto it.
  const halfLoaded = {
    imagePath: "job/background-a.jpg",
    imageX: 640,
    imageY: 400,
    imageScale: 1,
    imageRotation: 0,
    imageRealWidthFeet: null,
    imageBearing: 0,
    imageGeo: null,
    imageUploaded: false,
    propertyLine: [],
    houseOutline: [],
    photoOnPath: false,
  };

  it("keeps the photo's turn, zoom, line and house when the board has not loaded them", () => {
    expect(keepSavedGround(halfLoaded, stored)).toEqual(stored);
  });

  it("keeps a drawn line and house even from a board that has the photo", () => {
    const out = keepSavedGround({ ...stored, propertyLine: [], houseOutline: [], photoOnPath: true }, stored);
    expect(out.propertyLine).toEqual(stored.propertyLine);
    expect(out.houseOutline).toEqual(stored.houseOutline);
  });

  it("keeps where the photo was taken when the save has no record of it", () => {
    const out = keepSavedGround({ ...stored, imageGeo: null, imageBearing: 0 }, stored);
    expect(out.imageGeo).toEqual(geo);
    expect(out.imageBearing).toBe(288.8);
  });

  it("writes a real change on the same photo", () => {
    const moved = { ...stored, imageScale: 0.9, propertyLine: [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 6, y: 6 }], photoOnPath: true };
    const out = keepSavedGround(moved, stored);
    expect(out.imageScale).toBe(0.9);
    expect(out.propertyLine).toEqual(moved.propertyLine);
  });

  it("writes everything as sent for a new photo", () => {
    const fresh = { ...halfLoaded, imagePath: "job/background-b.jpg" };
    expect(keepSavedGround(fresh, stored)).toEqual({ ...fresh, photoOnPath: undefined });
  });

  it("writes everything as sent when nothing is stored yet", () => {
    expect(keepSavedGround(halfLoaded, null)).toEqual({ ...halfLoaded, photoOnPath: undefined });
  });

  it("only reads the stored map when a save could lose something", () => {
    expect(couldLoseGround(halfLoaded)).toBe(true);
    expect(couldLoseGround({ ...stored, photoOnPath: true })).toBe(false);
    expect(couldLoseGround({ ...halfLoaded, imagePath: null })).toBe(false);
  });
});
