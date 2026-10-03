import { describe, expect, it } from "vitest";

import { dotShape, feetPerBoardPixel, measuredShape } from "@/lib/dot-area";
import { groundToBoard } from "@/lib/lot-map";

const center = { x: 640, y: 400 };
const width = (pts: { x: number; y: number }[]) => Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
const height = (pts: { x: number; y: number }[]) => Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y));
const mid = (pts: { x: number; y: number }[]) => ({ x: (Math.max(...pts.map((p) => p.x)) + Math.min(...pts.map((p) => p.x))) / 2, y: (Math.max(...pts.map((p) => p.y)) + Math.min(...pts.map((p) => p.y))) / 2 });

describe("feetPerBoardPixel", () => {
  it("agrees with where the county's lot lands on the same photo", () => {
    // 100 feet due east of the photo's middle, by the map's own maths.
    const lat = 39.53134;
    const geo = { lng: -76.33782, lat, zoom: 18.19005373908, bearing: 0, request: 1280, kept: 1060 };
    const image = { x: 640, y: 400, scale: 0.719, rotation: 0, elementWidth: 2560 };
    const metres = 100 / 3.28084;
    const east: [number, number] = [geo.lng + metres / (111320 * Math.cos((lat * Math.PI) / 180)), lat];
    const onBoard = groundToBoard(east, geo, image);
    const pixels = Math.hypot(onBoard.x - image.x, onBoard.y - image.y);
    const perPx = feetPerBoardPixel({ lat, zoom: geo.zoom, request: geo.request, elementWidth: image.elementWidth, scale: image.scale })!;
    expect(100 / perPx).toBeCloseTo(pixels, 0);
  });

  it("is smaller the further in the photo is zoomed", () => {
    const base = { lat: 39.53, zoom: 18.19, request: 1280, elementWidth: 2560 };
    const far = feetPerBoardPixel({ ...base, scale: 0.7 })!;
    const near = feetPerBoardPixel({ ...base, scale: 1.4 })!;
    expect(far).toBeGreaterThan(near);
    expect(far / near).toBeCloseTo(2, 5);
  });

  it("is about a third of a foot to a foot a pixel for a house lot", () => {
    const f = feetPerBoardPixel({ lat: 39.53, zoom: 18.19, request: 1280, elementWidth: 2560, scale: 0.719 })!;
    expect(f).toBeGreaterThan(0.2);
    expect(f).toBeLessThan(1.5);
  });

  it("is null when nothing is known", () => {
    expect(feetPerBoardPixel({ lat: NaN, zoom: 18, request: 1280, elementWidth: 2560, scale: 1 })).toBeNull();
    expect(feetPerBoardPixel({ lat: 39, zoom: 18, request: 0, elementWidth: 2560, scale: 1 })).toBeNull();
  });
});

describe("dotShape", () => {
  it("is a square about 12 feet across, on the dot", () => {
    const pts = dotShape(center, 0.25);
    expect(width(pts)).toBeCloseTo(48, 5);
    expect(height(pts)).toBeCloseTo(48, 5);
    expect(mid(pts)).toEqual(center);
  });

  it("is never smaller than can be seen", () => {
    expect(width(dotShape(center, 2))).toBe(30);
  });

  it("is a fixed size with no scale", () => {
    expect(width(dotShape(center, null))).toBe(56);
  });
});

describe("measuredShape", () => {
  const current = dotShape(center, 0.5);

  it("takes length by width, the long side across, on the dot", () => {
    const pts = measuredShape(center, current, { kind: "area", lengthFt: 40, widthFt: 10, areaSqFt: 400 }, 0.5);
    expect(width(pts)).toBeCloseTo(80, 5);
    expect(height(pts)).toBeCloseTo(20, 5);
    expect(mid(pts)).toEqual(center);
    const tall = measuredShape(center, current, { kind: "area", lengthFt: 10, widthFt: 40, areaSqFt: 400 }, 0.5);
    expect(width(tall)).toBeCloseTo(80, 5);
  });

  it("sizes length by width to the feet", () => {
    const pts = measuredShape(center, current, { kind: "area", lengthFt: 60, widthFt: 30, areaSqFt: 1800 }, 0.5);
    expect(width(pts) * 0.5).toBeCloseTo(60, 5);
    expect(height(pts) * 0.5).toBeCloseTo(30, 5);
  });

  it("draws a run as a thin strip", () => {
    const pts = measuredShape(center, current, { kind: "linear", lengthFt: 50, widthFt: null, areaSqFt: null }, 0.5);
    expect(width(pts)).toBeCloseTo(100, 5);
    expect(height(pts)).toBeCloseTo(6, 5); // 2 ft is 4 px: held to the smallest drawn
  });

  it("makes a square from a square footage alone", () => {
    const pts = measuredShape(center, current, { kind: "area", lengthFt: null, widthFt: null, areaSqFt: 400 }, 0.5);
    expect(width(pts) * 0.5).toBeCloseTo(20, 5);
    expect(height(pts) * 0.5).toBeCloseTo(20, 5);
  });

  it("keeps the shape when nothing is measured or there is no scale", () => {
    expect(measuredShape(center, current, { kind: "none", lengthFt: null, widthFt: null, areaSqFt: null }, 0.5)).toBe(current);
    expect(measuredShape(center, current, { kind: "area", lengthFt: 40, widthFt: 10, areaSqFt: 400 }, null)).toBe(current);
  });

  it("draws a small bed true to size", () => {
    const pts = measuredShape(center, current, { kind: "area", lengthFt: 10, widthFt: 8, areaSqFt: 80 }, 1);
    expect(width(pts)).toBeCloseTo(10, 5);
    expect(height(pts)).toBeCloseTo(8, 5);
  });

  it("does not let a typo swallow the map", () => {
    const pts = measuredShape(center, current, { kind: "area", lengthFt: 5000, widthFt: 5000, areaSqFt: 25_000_000 }, 0.5);
    expect(width(pts)).toBe(900);
  });
});
