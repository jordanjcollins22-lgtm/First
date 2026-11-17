import { describe, expect, it } from "vitest";

import { pointInRing, type LngLat } from "@/lib/lot-map";
import { ringSqft, yardAround } from "@/lib/yard-shape";

// A small local grid: 1 unit = 1 metre east / north of a point in Harford.
const O: LngLat = [-76.3, 39.5];
const kx = Math.cos((O[1] * Math.PI) / 180) * 111320;
const m = (x: number, y: number): LngLat => [O[0] + x / kx, O[1] + y / 110574];
const rect = (x0: number, y0: number, x1: number, y1: number): LngLat[] => [m(x0, y0), m(x1, y0), m(x1, y1), m(x0, y1), m(x0, y0)];

describe("a home's own yard where the county has no line round it", () => {
  it("cuts a townhouse row down to the pin's home and its share of the land", () => {
    // A row of six 6.5 m homes, 39 m long and 10 m deep, on one big community lot.
    const row = rect(0, 0, 39, 10);
    const lot = rect(-30, -30, 70, 40);
    const yard = yardAround({ pin: m(16, 5), building: row, others: [], allowed: [lot], reachMetres: 9 });
    expect(yard).not.toBeNull();
    // Its own home (13 to 19.5 m along) is in, the neighbours' homes are not.
    expect(pointInRing(m(16, 5), yard!)).toBe(true);
    expect(pointInRing(m(5, 5), yard!)).toBe(false);
    expect(pointInRing(m(30, 5), yard!)).toBe(false);
    // Front and back yard, but not the whole community.
    expect(pointInRing(m(16, 15), yard!)).toBe(true);
    expect(pointInRing(m(16, -5), yard!)).toBe(true);
    expect(ringSqft(yard!)).toBeLessThan(2500);
  });

  it("stops halfway to the next house and at land that isn't common", () => {
    const home = rect(0, 0, 10, 10);
    const neighbour = rect(20, 0, 30, 10);
    const common = rect(-20, -20, 40, 30);
    const yard = yardAround({ pin: m(5, 5), building: home, others: [neighbour], allowed: [home, common], splitRow: false });
    expect(pointInRing(m(14, 5), yard!)).toBe(true);
    expect(pointInRing(m(16, 5), yard!)).toBe(false);
    // Off the common land (a road, or somebody's lot) is never in it.
    const small = yardAround({ pin: m(5, 5), building: home, others: [], allowed: [home, rect(-3, -3, 13, 13)], splitRow: false });
    expect(pointInRing(m(-5, 5), small!)).toBe(false);
    expect(pointInRing(m(-2, 5), small!)).toBe(true);
  });
});
