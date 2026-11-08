import { describe, expect, it } from "vitest";
import { BRAND_OPTIONS, contrastOnWhite } from "./brand-colors";

describe("brand colour options", () => {
  it("keep white text readable on every button colour", () => {
    for (const o of BRAND_OPTIONS) expect(contrastOnWhite(o.primary)).toBeGreaterThanOrEqual(4.5);
  });

  it("recommend exactly one", () => {
    expect(BRAND_OPTIONS.filter((o) => o.recommended)).toHaveLength(1);
  });

  it("match the app's theme to the recommended colour", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("src/app/globals.css", "utf8");
    const pick = BRAND_OPTIONS.find((o) => o.recommended)!;
    expect(css).toContain(`--primary: ${pick.primary};`);
    expect(css).toContain(`--primary: ${pick.primaryDark};`);
  });
});
