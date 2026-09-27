import { describe, expect, it } from "vitest";

import { compareUpsell, instantPrice, UNSEEN_PREMIUM } from "./instant-price";
import { cleanAnswers } from "./evaluation-intake";

const pricing = (service_type_id: string, name: string, minutes_per_sqft: number | null, estimated_hours: number | null = null, pricing_basis = "area") => ({
  organization_id: "org",
  service_type_id,
  name,
  status: "active" as const,
  requested_by: null,
  requested_note: null,
  cogs: null,
  cost: null,
  cost_unit: "sqft",
  pricing_basis: pricing_basis as never,
  estimated_hours,
  minutes_per_sqft,
  crew_size: 2,
  how_to: null,
  scope_template: null,
  performed_by: "own" as const,
  partner_name: null,
  updated_at: "",
});

const catalog = {
  servicePricing: [
    pricing("landscape-bed", "Landscape Bed", 0.1),
    pricing("lawn-care", "Lawn Care", 0.01),
    pricing("lawn-restoration", "Lawn Restoration", 0.02),
    pricing("plant-bush-removal", "Plant / Bush Removal", null, 3, "count"),
    pricing("custom-snow", "Snow Removal", 0.02),
  ],
  serviceMaterialRules: [],
  materials: [],
  crewCostPerHourCents: 3000,
  markup: { multiplier: 2, overheadPercent: 10, overheadPerCrewHourCents: null },
  measurementUnit: "sqft",
  measurementBasis: "area" as never,
};

describe("instant price", () => {
  it("prices each service through the rate card, adds the unseen premium, and rounds up to $25", () => {
    const answers = cleanAnswers({ services: ["beds", "lawn"], areas: ["front"] });
    const price = instantPrice(answers, { lotSqft: 12000, structureSqft: 2400 }, catalog);
    expect(price.lines.map((l) => l.priceAs)).toEqual(["Landscape Bed", "Lawn Care"]);
    expect(price.lines.every((l) => (l.priceCents ?? 0) > 0)).toBe(true);
    expect(price.totalCents % 2500).toBe(0);
    expect(price.totalCents).toBeGreaterThanOrEqual(Math.round(price.subtotalCents * (1 + UNSEEN_PREMIUM)));
    expect(price.basis).toContain("12,000");
  });

  it("prices a bigger part of the yard higher", () => {
    const front = instantPrice(cleanAnswers({ services: ["lawn"], areas: ["front"] }), { lotSqft: 20000, structureSqft: 2000 }, catalog);
    const whole = instantPrice(cleanAnswers({ services: ["lawn"], areas: ["whole"] }), { lotSqft: 20000, structureSqft: 2000 }, catalog);
    expect(whole.subtotalCents).toBeGreaterThan(front.subtotalCents);
  });

  it("uses lawn repair when the lawn needs fixing, and finds snow removal by name", () => {
    const price = instantPrice(cleanAnswers({ services: ["lawn", "snow"], details: { lawn_need: ["patch"] } }), null, catalog);
    expect(price.lines.map((l) => l.priceAs)).toEqual(["Lawn Restoration", "Snow Removal"]);
    expect(price.basis).toContain("typical");
  });

  it("leaves what it cannot price to the visit", () => {
    const price = instantPrice(cleanAnswers({ services: ["hardscape", "holiday"] }), null, catalog);
    expect(price.lines.every((l) => l.priceCents === null)).toBe(true);
    expect(price.totalCents).toBe(0);
  });
});

describe("asked for, then found", () => {
  const areas = [
    { typeId: "landscape-bed", label: "Landscape Bed", priceCents: 90000 },
    { typeId: "trimming", label: "Trimming", priceCents: 30000 },
    { typeId: "soft-washing", label: "Soft Washing", priceCents: 40000 },
    { typeId: "custom-1", label: "Weed Removal", priceCents: 10000 },
  ];

  it("counts what nothing they asked for covers as the evaluator's addition", () => {
    const result = compareUpsell(["beds"], areas);
    expect(result.added.map((a) => a.label)).toEqual(["Trimming", "Soft Washing", "Weed Removal"]);
    expect(result.addedCents).toBe(80000);
    expect(result.notOnMap).toEqual([]);
  });

  it("says what they asked for that never made the map", () => {
    const result = compareUpsell(["beds", "cleanup", "drainage", "other"], areas);
    expect(result.added.map((a) => a.label)).toEqual(["Soft Washing"]);
    expect(result.notOnMap).toEqual(["drainage"]);
  });
});
