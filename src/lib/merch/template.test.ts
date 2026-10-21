import { describe, expect, it } from "vitest";

import { renderBarcode } from "./barcode";
import { findBarcodeSlot, findSvgSize, rasterDesignSvg, renderDesign, validateTemplate } from "./template";

const DESIGN = `<svg xmlns="http://www.w3.org/2000/svg" width="3.5in" height="2in" viewBox="0 0 350 200">
  <text x="20" y="40">JS Landscaping</text>
  <text x="20" y="70">Free yard evaluations</text>
  <rect id="barcode-slot" x="20" y="100" width="310" height="80" fill="#eee"/>
</svg>`;

describe("findBarcodeSlot", () => {
  it("reads the slot box regardless of attribute order or quotes", () => {
    expect(findBarcodeSlot(DESIGN)).toEqual({ x: 20, y: 100, width: 310, height: 80 });
    expect(
      findBarcodeSlot(`<svg><rect height='5.5' width='10' id='barcode-slot'></rect></svg>`)
    ).toEqual({ x: 0, y: 0, width: 10, height: 5.5 });
  });

  it("rejects a missing or zero-size slot", () => {
    expect(findBarcodeSlot(`<svg><rect id="other" width="1" height="1"/></svg>`)).toBeNull();
    expect(findBarcodeSlot(`<svg><rect id="barcode-slot" width="0" height="10"/></svg>`)).toBeNull();
  });
});

describe("validateTemplate", () => {
  it("accepts a good design", () => {
    expect(validateTemplate(DESIGN)).toEqual([]);
  });

  it("flags non-SVGs, scripts and a missing slot", () => {
    expect(validateTemplate("hello")).toHaveLength(2);
    expect(validateTemplate(`<svg onload="x()"><rect id="barcode-slot" width="1" height="1"/></svg>`))
      .toHaveLength(1);
  });
});

describe("renderDesign", () => {
  it("swaps only the slot for the barcode", () => {
    const barcode = renderBarcode("code128", "TM-0042");
    if (!barcode.ok) throw new Error(barcode.error);
    const out = renderDesign(DESIGN, { barcodeSvg: barcode.svg });

    expect(out).not.toContain("barcode-slot");
    expect(out).toContain('<svg x="20" y="100" width="310" height="80"');
    expect(out).toContain('preserveAspectRatio="xMidYMid meet"');
    // Everything else stays exactly as designed.
    expect(out).toContain("Free yard evaluations");
    expect(out.match(/<svg\b/g)).toHaveLength(2);
  });
});

describe("renderBarcode", () => {
  it("renders each supported format", () => {
    expect(renderBarcode("qrcode", "https://example.com").ok).toBe(true);
    expect(renderBarcode("upca", "03600029145").ok).toBe(true);
    expect(renderBarcode("ean13", "590123412345").ok).toBe(true);
  });

  it("returns a readable error for bad input", () => {
    const result = renderBarcode("ean13", "abc");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toMatch(/^bwipp/);
    expect(renderBarcode("code128", "  ").ok).toBe(false);
  });
});

describe("seeded truck magnet design", () => {
  it("is a valid template with no phone number", async () => {
    const { readFileSync } = await import("node:fs");
    const seed = readFileSync("supabase/seed/0002_merch_products.sql", "utf8");
    const svg = seed.match(/'(<svg[\s\S]*?<\/svg>)'/)?.[1] ?? "";
    expect(validateTemplate(svg)).toEqual([]);
    expect(svg).not.toMatch(/\d{3}-\d{3}-\d{4}/);
    expect(svg).not.toMatch(/\{\{/);
  });
});

describe("rasterDesignSvg", () => {
  it("wraps an image at print size with a covered barcode slot", () => {
    const svg = rasterDesignSvg({
      dataUrl: "data:image/png;base64,AAAA",
      pixelWidth: 3600,
      pixelHeight: 1800,
      printWidthIn: 24,
      slot: { x: 2797, y: 90, width: 676, height: 676 },
    });
    expect(svg).toContain('width="24in" height="12in" viewBox="0 0 3600 1800"');
    expect(validateTemplate(svg)).toEqual([]);
    expect(findBarcodeSlot(svg)).toEqual({ x: 2797, y: 90, width: 676, height: 676 });
    // White cover sits under the slot, slightly larger.
    expect(svg).toMatch(/<rect x="2777" y="70" width="716" height="716" fill="#ffffff"\/>/);
  });
});

describe("findSvgSize", () => {
  it("reads inches and viewBox width", () => {
    expect(findSvgSize(DESIGN)).toEqual({ widthIn: 3.5, viewBoxWidth: 350 });
    expect(findSvgSize('<svg width="300px" viewBox="0,0,10,5">')).toEqual({ widthIn: null, viewBoxWidth: 10 });
  });
});
