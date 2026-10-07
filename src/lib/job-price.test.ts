import { describe, expect, it } from "vitest";

import { jobCosts, priceSiteMap } from "./job-price";
import { margin } from "./gross-profit";
import { DEFAULT_SALT_SETTINGS } from "./salt";

const catalog = {
  servicePricing: [
    { service_type_id: "landscape-bed", name: "Landscape Bed", status: "active", pricing_basis: "area", minutes_per_sqft: 0.3, estimated_hours: null, crew_size: 1 },
  ] as never,
  serviceMaterialRules: [{ id: "r", service_type_id: "landscape-bed", material_id: "m", match_field: "material", match_value: "Mulch", created_at: "" }],
  materials: [{ id: "m", name: "Mulch", unit: "cubic yards", coverage_per_unit_sqft: 100, waste_factor_pct: 0, cost_per_unit: 40 }] as never,
  crewCostPerHourCents: 3000,
  markup: { multiplier: 2, overheadPercent: 10, overheadPerCrewHourCents: null },
  salt: DEFAULT_SALT_SETTINGS,
} as never;
const z = (name: string, typeId: string, area: number | null, values: Record<string, string> = {}) =>
  ({ id: name, name, color: "#000", points: [], location: "", service: { typeId, values, notes: "", photos: [], tools: [] }, areaSqFt: area, perimeterFt: null }) as never;
const travel = { toSiteMinutes: 25, fromSiteMinutes: 25, pickupExtraMinutes: 10, from: "Shop", pickupFrom: "Lehnhoff's", notes: [] };

describe("a site map priced the one way", () => {
  it("adds travel and whole hours, holds 50% after the fee, and the areas add up", () => {
    const priced = priceSiteMap({
      zones: [z("Front", "landscape-bed", 200, { material: "Mulch" }), z("Back", "landscape-bed", 100, { material: "Mulch" })],
      catalog,
      travel,
      feePct: 15,
    });
    expect(priced.areaPricesCents.reduce((a, b) => a + b, 0)).toBe(priced.totalCents);
    // 1.5 hours on site and an hour in the truck: 3 hours on the clock.
    expect(priced.estimate.billedHours).toBe(3);
    const costs = jobCosts(priced);
    expect(costs.labourCents).toBe(3 * 3000);
    expect(costs.labour.map((l) => l.label)).toEqual(["Labour on site", "Travel", "Rounded up to the hour"]);
    expect(costs.labour[1].detail).toBe("Shop → Lehnhoff's → the house → back: 25 + 10 + 25 min");
    expect(margin(priced.totalCents, costs.labourCents, costs.materialsCents, 15).grossPct).toBeGreaterThanOrEqual(0.5);
  });

  it("prices salting a visit at a time, and counts its visits", () => {
    const priced = priceSiteMap({ zones: [z("Drive", "salting", null, { surface: "Driveway", treatments: "3" })], catalog, travel, feePct: 15 });
    const costs = jobCosts(priced);
    expect(costs.visits).toBe(3);
    expect(priced.estimate.priceCents).toBe(0);
    expect(costs.labour[0].label).toBe("Salting visits");
    expect(margin(priced.totalCents, costs.labourCents, costs.materialsCents, 15).grossPct).toBeGreaterThanOrEqual(0.5);
  });
});
