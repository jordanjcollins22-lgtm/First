import { describe, expect, it } from "vitest";

import { qrSvg } from "./qr";

/** The grid size the generator chose, read off the SVG's own viewBox. */
function modules(svg: string): number {
  const box = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  if (!box) throw new Error("no viewBox");
  return Number(box[1]);
}

const SCAN_URL = "https://app.jslandscapingmd.com/w/249AWR";

describe("a QR that has to survive a printer", () => {
  it("turns off anti-aliasing, which is what makes a small code grey mush", async () => {
    expect(await qrSvg(SCAN_URL, 256, "M")).toContain('shape-rendering="crispEdges"');
  });

  it("gets a bigger module for the same square at M than at H", async () => {
    // The whole reason the weed sheet asks for M. The same address needs a
    // denser grid at H, and at three-quarters of an inch it is module size,
    // not code size, that decides whether a phone reads it.
    const forgiving = modules(await qrSvg(SCAN_URL, 256, "H"));
    const coarse = modules(await qrSvg(SCAN_URL, 256, "M"));
    expect(coarse).toBeLessThan(forgiving);
  });

  it("keeps a printed module comfortably above what a 300dpi printer can hold", async () => {
    // 0.75in across, quiet zone included. Under about four dots a module and
    // ink spread starts closing the gaps.
    const grid = modules(await qrSvg(SCAN_URL, 256, "M"));
    const dotsPerModule = (0.75 * 300) / grid;
    expect(dotsPerModule).toBeGreaterThan(4);
  });

  it("would have failed at the size the sheet used before", async () => {
    // 28px for the level-H grid: under one pixel a module. This is the bug.
    const grid = modules(await qrSvg(SCAN_URL, 96, "H"));
    expect(28 / grid).toBeLessThan(1);
  });

  it("leaves a quiet zone, so a code against a border still acquires", async () => {
    // A version-3 code is 29 modules; the viewBox is 33, which is those plus
    // two clear modules each side. A code butted against a border fails to
    // acquire, and the sheet prints these inside a bordered cell.
    const svg = await qrSvg(SCAN_URL, 256, "M");
    expect(modules(svg)).toBe(33);
    // The white ground is painted across the whole box, quiet zone included,
    // rather than left to whatever is behind it.
    expect(svg).toContain('fill="#ffffff" d="M0 0h33v33H0z"');
  });

  it("still defaults to the forgiving level, for stickers living in a yard", async () => {
    expect(modules(await qrSvg(SCAN_URL))).toBe(modules(await qrSvg(SCAN_URL, 128, "H")));
  });
});
