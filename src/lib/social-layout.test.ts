import { describe, expect, it } from "vitest";

import { CARD, DEFAULT_LAYOUT, GAP, barSize, headline, photoSpaces, tidyLayout } from "./social-layout";

describe("tidyLayout", () => {
  it("keeps today's look when nothing was chosen", () => {
    expect(tidyLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(tidyLayout({ arrange: "diagonal", fit: 3 })).toEqual(DEFAULT_LAYOUT);
  });

  it("keeps each choice that is one of its options", () => {
    expect(tidyLayout({ arrange: "side", fit: "whole", text: "small", bar: "thin" })).toEqual({ arrange: "side", fit: "whole", text: "small", bar: "thin" });
  });
});

describe("photoSpaces", () => {
  it("fills the picture top to bottom: photos, gap, headline and bar", () => {
    const layout = { ...DEFAULT_LAYOUT, text: "small" as const, bar: "thin" as const };
    const s = photoSpaces("split", layout);
    expect(s.before!.height + GAP + s.after.height + headline("small", "split").panel + barSize("thin").height).toBe(CARD.height);
  });

  it("gives the photos more room with a smaller headline and a thinner bar", () => {
    const big = photoSpaces("split", DEFAULT_LAYOUT).after.height;
    const roomy = photoSpaces("split", { ...DEFAULT_LAYOUT, text: "small", bar: "thin" }).after.height;
    expect(roomy).toBeGreaterThan(big);
  });

  it("puts the two photos next to each other, each a tall space, side by side", () => {
    const s = photoSpaces("split", { ...DEFAULT_LAYOUT, arrange: "side" });
    expect(s.before!.width + GAP + s.after.width).toBe(CARD.width);
    expect(s.after.height).toBeGreaterThan(s.after.width);
  });

  it("gives a single photo the whole picture", () => {
    expect(photoSpaces("photo", DEFAULT_LAYOUT)).toEqual({ before: null, after: { width: CARD.width, height: CARD.height } });
  });
});
