import { describe, expect, it } from "vitest";

import { nearestNeighborSequence } from "./sequencing";

describe("nearestNeighborSequence", () => {
  it("visits items in order of proximity from the start point", () => {
    const items = [
      { id: "far", centroid: [-80.8, 35.2] as [number, number] },
      { id: "near", centroid: [-80.843, 35.227] as [number, number] },
      { id: "mid", centroid: [-80.82, 35.21] as [number, number] },
    ];
    const order = nearestNeighborSequence(items, [-80.8431, 35.2271]);
    expect(order).toEqual(["near", "mid", "far"]);
  });

  it("returns an empty sequence for no items", () => {
    expect(nearestNeighborSequence([])).toEqual([]);
  });

  it("visits every item exactly once", () => {
    const items = Array.from({ length: 8 }, (_, i) => ({
      id: `item-${i}`,
      centroid: [-80.84 + i * 0.001, 35.22 + (i % 3) * 0.0007] as [
        number,
        number
      ],
    }));
    const order = nearestNeighborSequence(items);
    expect(order.length).toBe(items.length);
    expect(new Set(order).size).toBe(items.length);
  });
});
