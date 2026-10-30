import { describe, expect, it } from "vitest";

import { DEFAULT_TIERS, isTierId, readTiers, tierById } from "@/lib/evaluation-tiers";

describe("readTiers", () => {
  it("uses the defaults when nothing is set", () => {
    expect(readTiers(null)).toEqual(DEFAULT_TIERS);
    expect(readTiers("junk")).toEqual(DEFAULT_TIERS);
  });

  it("takes the business's name, price and list for a tier", () => {
    const tiers = readTiers([{ id: "design", name: "Full design", priceCents: 49900, includes: ["3D concept"] }]);
    expect(tierById(tiers, "design")).toMatchObject({ name: "Full design", priceCents: 49900, includes: ["3D concept"] });
    // The others stay as they were.
    expect(tierById(tiers, "basic")).toEqual(DEFAULT_TIERS[0]);
  });

  it("ignores a bad price or an empty list, keeping the default for that field", () => {
    const tiers = readTiers([{ id: "basic", priceCents: -5, includes: [] }, { id: "measured", priceCents: 12.5 }]);
    expect(tierById(tiers, "basic")?.priceCents).toBe(DEFAULT_TIERS[0].priceCents);
    expect(tierById(tiers, "basic")?.includes).toEqual(DEFAULT_TIERS[0].includes);
    expect(tierById(tiers, "measured")?.priceCents).toBe(DEFAULT_TIERS[1].priceCents);
  });

  it("always offers the same three, in order", () => {
    expect(readTiers([{ id: "platinum", name: "Extra" }]).map((t) => t.id)).toEqual(["basic", "measured", "design"]);
  });
});

describe("isTierId", () => {
  it("knows the three tiers and nothing else", () => {
    expect(isTierId("design")).toBe(true);
    expect(isTierId("deposit")).toBe(false);
    expect(isTierId(undefined)).toBe(false);
  });
});
