import { describe, expect, it } from "vitest";

import { chunk } from "./chunk";

describe("chunk", () => {
  it("cuts a list into pieces of at most the size asked for", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("leaves a list shorter than the size in one piece", () => {
    expect(chunk([1, 2, 3], 500)).toEqual([[1, 2, 3]]);
  });

  it("has nothing to send for an empty list", () => {
    // The caller loops over the result, so nothing to do has to mean no
    // statements rather than one empty one.
    expect(chunk([], 500)).toEqual([]);
  });

  it("keeps every item exactly once and in order", () => {
    const items = Array.from({ length: 671 }, (_, i) => i);
    expect(chunk(items, 500).flat()).toEqual(items);
  });

  it("sends a 671 row import as two statements", () => {
    expect(chunk(Array.from({ length: 671 }), 500).map((piece) => piece.length)).toEqual([500, 171]);
  });

  it("still makes progress when asked for a size of zero", () => {
    expect(chunk([1, 2], 0)).toEqual([[1], [2]]);
  });
});
