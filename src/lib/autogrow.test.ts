import { describe, expect, it } from "vitest";

import { COMPOSER_MAX_HEIGHT, growHeight } from "./autogrow";

describe("growHeight", () => {
  it("keeps an empty box at its resting size", () => {
    expect(growHeight({ scrollHeight: 12, min: 40, max: 200 })).toEqual({ height: 40, scrollable: false });
  });

  it("grows with the message", () => {
    expect(growHeight({ scrollHeight: 96, min: 40, max: 200 })).toEqual({ height: 96, scrollable: false });
  });

  it("stops at the ceiling and scrolls from there", () => {
    expect(growHeight({ scrollHeight: 900, min: 40, max: 200 })).toEqual({ height: 200, scrollable: true });
  });

  it("does not report scrolling at exactly the ceiling", () => {
    expect(growHeight({ scrollHeight: 200, min: 40, max: 200 }).scrollable).toBe(false);
  });

  it("rounds a fractional measurement up, so the last line is never clipped", () => {
    expect(growHeight({ scrollHeight: 88.4, min: 40, max: 200 }).height).toBe(89);
  });

  it("survives a max below the min rather than collapsing the box", () => {
    expect(growHeight({ scrollHeight: 300, min: 40, max: 10 })).toEqual({ height: 40, scrollable: true });
  });

  it("leaves room to read a paragraph back", () => {
    expect(COMPOSER_MAX_HEIGHT).toBeGreaterThanOrEqual(160);
  });
});
