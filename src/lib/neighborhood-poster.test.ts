import { describe, expect, it } from "vitest";

import {
  BANDS,
  bandFor,
  COLOURS,
  fitToWidth,
  offerLines,
  posterBookingPath,
  scanLayout,
  SIDE_MARGIN,
  WORDS,
} from "@/lib/neighborhood-poster";

describe("the bands down the poster", () => {
  it("runs top to bottom in order", () => {
    for (let i = 1; i < BANDS.length; i += 1) {
      expect(BANDS[i].top).toBeGreaterThanOrEqual(BANDS[i - 1].bottom);
    }
  });

  it("never overlaps and never leaves the paper", () => {
    for (const band of BANDS) {
      expect(band.top).toBeGreaterThanOrEqual(0);
      expect(band.bottom).toBeLessThanOrEqual(1);
      expect(band.bottom).toBeGreaterThan(band.top);
    }
  });

  it("gives the offer the most room, because it is the thing being decided", () => {
    const height = (key: string) => bandFor(key).bottom - bandFor(key).top;
    for (const other of ["logo", "working", "neighborhood"]) {
      expect(height("offer")).toBeGreaterThan(height(other));
    }
  });

  it("leaves air between the bands rather than stacking them", () => {
    // A sign with no gaps reads as a leaflet.
    for (let i = 1; i < BANDS.length; i += 1) {
      expect(BANDS[i].top - BANDS[i - 1].bottom).toBeGreaterThan(0);
    }
  });

  it("complains about a band nobody defined", () => {
    expect(() => bandFor("nope")).toThrow();
  });

  it("keeps a margin at the sides", () => {
    expect(SIDE_MARGIN).toBeGreaterThan(0);
    expect(SIDE_MARGIN).toBeLessThan(0.15);
  });
});

describe("sizing type to fill its box", () => {
  /** A stand-in font: every character half the point size wide. */
  const halfWidth = (text: string) => (size: number) => text.length * size * 0.5;

  it("makes a line exactly fill the width it is given", () => {
    const size = fitToWidth("ABCD", 100, 1000, halfWidth("ABCD"));
    expect(halfWidth("ABCD")(size)).toBeCloseTo(100, 6);
  });

  it("stops at the height when the box is short and wide", () => {
    const size = fitToWidth("AB", 1000, 36, halfWidth("AB"));
    expect(size * 0.72).toBeCloseTo(36, 6);
  });

  it("makes a longer line smaller, so both fit the same box", () => {
    const short = fitToWidth("SCAN", 100, 1000, halfWidth("SCAN"));
    const long = fitToWidth("NEIGHBORHOOD", 100, 1000, halfWidth("NEIGHBORHOOD"));
    expect(long).toBeLessThan(short);
  });

  it("is nothing for nothing", () => {
    expect(fitToWidth("", 100, 100, halfWidth(""))).toBe(0);
    expect(fitToWidth("   ", 100, 100, halfWidth("   "))).toBe(0);
  });
});

describe("the bottom row", () => {
  const layout = scanLayout(20, 6.9);

  it("puts the code in the middle, because it is the point of the row", () => {
    expect(layout.qrLeft + layout.qrSize / 2).toBeCloseTo(10, 6);
  });

  it("keeps the code big enough to photograph from the pavement", () => {
    // About a fifth of the poster's width. Smaller than this and a phone at
    // ten feet cannot resolve the modules.
    expect(layout.qrSize).toBeGreaterThanOrEqual(20 * 0.2);
  });

  it("does not let the code grow taller than its band", () => {
    expect(scanLayout(20, 3).qrSize).toBeLessThanOrEqual(3);
  });

  it("leaves the arrow and the fallback on opposite sides of it", () => {
    expect(layout.arrowRight).toBeLessThan(layout.qrLeft);
    expect(layout.fallbackLeft).toBeGreaterThan(layout.qrLeft + layout.qrSize);
  });

  it("leaves room on both sides for something to go in", () => {
    expect(layout.arrowRight).toBeGreaterThan(0);
    expect(layout.fallbackLeft).toBeLessThan(20);
  });
});

describe("where a scan of the sign lands", () => {
  it("goes to the booking form, tagged so we know the sign did it", () => {
    expect(posterBookingPath("js-landscaping-md")).toBe(
      "/book?src=neighborhood-sign&org=js-landscaping-md"
    );
  });

  it("still goes somewhere for a business with no slug", () => {
    expect(posterBookingPath(null)).toBe("/book?src=neighborhood-sign");
    expect(posterBookingPath("  ")).toBe("/book?src=neighborhood-sign");
  });
});

describe("what the sign says", () => {
  it("says the two things a neighbour needs: who, and what is in it for them", () => {
    expect(WORDS.working).toContain("WORKING");
    expect(WORDS.offerBig.join(" ")).toContain("DISCOUNT");
  });

  it("gives somebody who cannot scan a way through", () => {
    expect(WORDS.fallbackTitle.toLowerCase()).toContain("scan");
    expect(WORDS.fallbackLines.join(" ").toLowerCase()).toContain("text");
  });

  it("has a colour for everything the drawing needs", () => {
    for (const colour of Object.values(COLOURS)) {
      expect(colour).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});

describe("the lines inside the offer box", () => {
  const BOX = 6.9;
  const lines = offerLines(BOX, 2);

  it("stacks them down the box in order", () => {
    expect(lines.small.baseline).toBeLessThan(lines.big[0].baseline);
    expect(lines.big[0].baseline).toBeLessThan(lines.big[1].baseline);
  });

  it("never lets one line print through the one above it", () => {
    // A short word set to a width is a tall word: DISCOUNT came out half an
    // inch taller than NEIGHBORHOOD and ran straight through it.
    const all = [lines.small, ...lines.big];
    for (let i = 1; i < all.length; i += 1) {
      const capTop = all[i].baseline - all[i].maxHeight;
      expect(capTop).toBeGreaterThanOrEqual(all[i - 1].baseline);
    }
  });

  it("keeps every line inside the box", () => {
    for (const line of [lines.small, ...lines.big]) {
      expect(line.baseline - line.maxHeight).toBeGreaterThan(0);
      expect(line.baseline).toBeLessThan(BOX);
    }
  });

  it("gives the big lines more room than the small one", () => {
    expect(lines.big[0].maxHeight).toBeGreaterThan(lines.small.maxHeight);
  });

  it("scales with the box rather than assuming a size", () => {
    const small = offerLines(3, 2);
    expect(small.big[0].maxHeight).toBeCloseTo(lines.big[0].maxHeight * (3 / BOX), 6);
  });

  it("copes with one big line, or none", () => {
    expect(offerLines(BOX, 1).big).toHaveLength(1);
    expect(offerLines(BOX, 0).big).toEqual([]);
  });

  it("holds for the words actually on the sign", () => {
    expect(offerLines(BOX, WORDS.offerBig.length).big).toHaveLength(2);
  });
});
