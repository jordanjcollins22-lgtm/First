import { describe, expect, it } from "vitest";

import { PRICING_EQUATION, crewRateCents, projectCostMargin } from "@/lib/forward-pricing";
import { costToday, installedPriceCents, nativeLabel, onSale, plantPriceCents, plantingServiceKey } from "@/lib/plant-pricing";

const pcm = projectCostMargin(PRICING_EQUATION);

describe("costToday", () => {
  const plant = { costCents: 599, saleCents: 449, saleUntil: "2026-11-06" };

  it("is the sale price while the sale holds", () => {
    expect(costToday(plant, "2026-11-02")).toBe(449);
    expect(costToday(plant, "2026-11-06")).toBe(449);
    expect(onSale(plant, "2026-11-06")).toBe(true);
  });

  it("goes back to the list price the day after", () => {
    expect(costToday(plant, "2026-11-07")).toBe(599);
    expect(onSale(plant, "2026-11-07")).toBe(false);
  });

  it("is the list price when there is no sale", () => {
    expect(costToday({ costCents: 599, saleCents: null, saleUntil: null }, "2026-11-02")).toBe(599);
  });
});

describe("plantingServiceKey", () => {
  it("plants quarts, small pots and gallons like a 1 gal", () => {
    for (const size of ["Quart", '3.25"', "1G"]) expect(plantingServiceKey(size)).toBe("plant-install-1gal");
  });

  it("plants 2 and 3 gallons like a 3 gal", () => {
    expect(plantingServiceKey("2G")).toBe("plant-install-3gal");
    expect(plantingServiceKey("3G")).toBe("plant-install-3gal");
  });

  it("has no single planting for a flat or a plug tray", () => {
    expect(plantingServiceKey("Flat")).toBeNull();
    expect(plantingServiceKey("DP50")).toBeNull();
  });
});

describe("prices", () => {
  it("marks the plant up like any material", () => {
    expect(plantPriceCents(449)).toBe(Math.round(449 / pcm));
  });

  it("adds the crew's time to plant it", () => {
    // A 1 gal goes in at 12 an hour.
    expect(installedPriceCents(449, "1G")).toBe(Math.round((449 + crewRateCents(PRICING_EQUATION) / 12) / pcm));
    // A 3 gal at 6 an hour: more time, so more than the 1 gal at the same cost.
    expect(installedPriceCents(449, "3G")!).toBeGreaterThan(installedPriceCents(449, "1G")!);
  });

  it("has no installed price for a flat", () => {
    expect(installedPriceCents(4500, "Flat")).toBeNull();
  });
});

describe("nativeLabel", () => {
  it("reads the nursery's codes", () => {
    expect(nativeLabel("N")).toBe("Native");
    expect(nativeLabel("NS")).toBe("Native cultivar");
    expect(nativeLabel(null)).toBeNull();
  });
});
