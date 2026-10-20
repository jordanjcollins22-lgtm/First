import { describe, expect, it } from "vitest";

import { renderBarcode } from "./barcode";
import { findBarcodeSlot, renderDesign, templateFields, validateTemplate } from "./template";

const DESIGN = `<svg xmlns="http://www.w3.org/2000/svg" width="3.5in" height="2in" viewBox="0 0 350 200">
  <text x="20" y="40">{{name}}</text>
  <text x="20" y="70">{{ phone }} · {{name}}</text>
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

describe("templateFields", () => {
  it("lists each token once, in order", () => {
    expect(templateFields(DESIGN)).toEqual([
      { key: "name", label: "Name" },
      { key: "phone", label: "Phone" },
    ]);
    expect(templateFields("{{job_title}} {{crewLead}}").map((f) => f.label)).toEqual([
      "Job title",
      "Crew Lead",
    ]);
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
  it("swaps the slot for the barcode and fills tokens, escaping text", () => {
    const barcode = renderBarcode("code128", "TM-0042");
    if (!barcode.ok) throw new Error(barcode.error);
    const out = renderDesign(DESIGN, { barcodeSvg: barcode.svg, values: { name: "Ana & <Co>" } });

    expect(out).not.toContain("barcode-slot");
    expect(out).toContain('<svg x="20" y="100" width="310" height="80"');
    expect(out).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(out).toContain("Ana &amp; &lt;Co&gt;");
    // Missing values print blank rather than as raw tokens.
    expect(out).not.toMatch(/\{\{/);
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

describe("seeded magnet design", () => {
  it("is a valid template with name and title fields", async () => {
    const { readFileSync } = await import("node:fs");
    const seed = readFileSync("supabase/seed/0002_merch_products.sql", "utf8");
    const svg = seed.match(/'(<svg[\s\S]*?<\/svg>)'/)?.[1] ?? "";
    expect(validateTemplate(svg)).toEqual([]);
    expect(templateFields(svg).map((f) => f.key)).toEqual(["name", "title"]);
  });
});
