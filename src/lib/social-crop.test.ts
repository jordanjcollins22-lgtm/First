import { describe, expect, it } from "vitest";

import { cropBox, tidyCrop } from "@/lib/social-crop";

describe("placing a photo in its space", () => {
  it("fills the space and keeps the middle by default", () => {
    // A 4000x3000 landscape photo into a 1080x470 strip.
    expect(cropBox(4000, 3000, 1080, 470, { x: 50, y: 50, zoom: 1 })).toEqual({ width: 1080, height: 810, left: 0, top: 170 });
  });

  it("moves the window to the top, and zooms in", () => {
    expect(cropBox(4000, 3000, 1080, 470, { x: 50, y: 0, zoom: 1 }).top).toBe(0);
    const zoomed = cropBox(4000, 3000, 1080, 470, { x: 100, y: 100, zoom: 2 });
    expect(zoomed).toEqual({ width: 2160, height: 1620, left: 1080, top: 1150 });
  });

  it("keeps numbers in range", () => {
    expect(tidyCrop({ x: -5, y: 140, zoom: 9 })).toEqual({ x: 0, y: 100, zoom: 3 });
    expect(tidyCrop(null)).toEqual({ x: 50, y: 50, zoom: 1 });
  });
});
