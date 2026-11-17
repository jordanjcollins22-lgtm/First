import { describe, expect, it } from "vitest";

import { pointInRing, type LngLat } from "@/lib/lot-map";
import { ringSqft, yardAround } from "@/lib/yard-shape";

// A small local grid: 1 unit = 1 metre east / north of a point in Harford.
const O: LngLat = [-76.3, 39.5];
const kx = Math.cos((O[1] * Math.PI) / 180) * 111320;
const m = (x: number, y: number): LngLat => [O[0] + x / kx, O[1] + y / 110574];
const rect = (x0: number, y0: number, x1: number, y1: number): LngLat[] => [m(x0, y0), m(x1, y0), m(x1, y1), m(x0, y1), m(x0, y0)];

describe("a home's own yard where the county has no line round it", () => {
  const community = rect(-40, -40, 80, 60);

  it("cuts a townhouse row down to the pin's home and gives it a front and back yard", () => {
    // A row of six 6.5 m homes, 39 m long and 10 m deep, on one big community lot.
    const row = rect(0, 0, 39, 10);
    const yard = yardAround({ pin: m(16, 5), home: row, neighbours: [], allowed: [community] });
    expect(yard).not.toBeNull();
    // Its own home (13 to 19.5 m along) is in, the neighbours' homes are not.
    expect(pointInRing(m(16, 5), yard!)).toBe(true);
    expect(pointInRing(m(11, 5), yard!)).toBe(false);
    expect(pointInRing(m(30, 5), yard!)).toBe(false);
    // Front and back yard, but not the whole community.
    expect(pointInRing(m(16, 13), yard!)).toBe(true);
    expect(pointInRing(m(16, -3), yard!)).toBe(true);
    expect(ringSqft(yard!)).toBeLessThan(2600);
  });

  it("runs the front yard out to the sidewalk and no further", () => {
    const home = rect(0, 0, 6, 10);
    // The street's centerline runs 10 m in front of the home.
    const street = [m(-50, -10), m(50, -10)];
    const yard = yardAround({ pin: m(3, 5), home, splitRow: false, neighbours: [rect(-6, 0, 0, 10), rect(6, 0, 12, 10)], allowed: [community], front: m(3, -10), streets: [street] });
    expect(pointInRing(m(3, -3.5), yard!)).toBe(true);
    expect(pointInRing(m(3, -4.5), yard!)).toBe(false);
    expect(pointInRing(m(3, 17), yard!)).toBe(true);
  });

  it("stops at the county's sidewalk, but not at a front walk crossing the lawn", () => {
    const home = rect(0, 0, 6, 10);
    const sidewalk = rect(-50, -7, 50, -5.5);
    const frontWalk = rect(2.5, -5.5, 3.5, 0);
    const yard = yardAround({ pin: m(3, 5), home, splitRow: false, neighbours: [rect(-6, 0, 0, 10), rect(6, 0, 12, 10)], allowed: [community], front: m(3, -20), pavement: [sidewalk, frontWalk] });
    expect(pointInRing(m(1, -5), yard!)).toBe(true);
    expect(pointInRing(m(1, -6.5), yard!)).toBe(false);
  });

  it("reads a sidewalk network with holes as paved only on the walk itself", () => {
    const home = rect(0, 0, 6, 10);
    // The county sends a block's sidewalk as an outer ring with the block as a hole.
    const outer = rect(-60, -60, 60, 60);
    const block = rect(-50, -5.5, 50, 50);
    const yard = yardAround({ pin: m(3, 5), home, splitRow: false, neighbours: [rect(-6, 0, 0, 10), rect(6, 0, 12, 10)], allowed: [community], front: m(3, -20), pavement: [outer, block] });
    expect(pointInRing(m(1, -5), yard!)).toBe(true);
    expect(pointInRing(m(1, -6), yard!)).toBe(false);
  });

  it("keeps a clean strip behind a home whose neighbour sticks out further back", () => {
    // An end home with the next home in the row 6 m deeper.
    const home = rect(0, 0, 6, 10);
    const deeper = rect(6, 0, 12, 16);
    const yard = yardAround({ pin: m(3, 5), home, splitRow: false, neighbours: [deeper], allowed: [community], front: m(3, -20) });
    // Its own strip runs out the back, beside the neighbour's deeper end.
    expect(pointInRing(m(3, 17), yard!)).toBe(true);
    expect(pointInRing(m(8, 12), yard!)).toBe(false);
    // The open end gets a side yard.
    expect(pointInRing(m(-3, 5), yard!)).toBe(true);
  });

  it("stops halfway to the next house and at land that isn't common", () => {
    const home = rect(0, 0, 10, 10);
    const neighbour = rect(16, 0, 26, 10);
    const yard = yardAround({ pin: m(5, 5), home, splitRow: false, neighbours: [neighbour], allowed: [community] });
    expect(pointInRing(m(12.5, 5), yard!)).toBe(true);
    expect(pointInRing(m(14, 5), yard!)).toBe(false);
    // Off the common land (a road, or somebody's lot) is never in it.
    const small = yardAround({ pin: m(5, 5), home, splitRow: false, neighbours: [], allowed: [home, rect(-3, -3, 13, 13)] });
    expect(pointInRing(m(-2, 5), small!)).toBe(true);
    expect(pointInRing(m(-5, 5), small!)).toBe(false);
  });
});
