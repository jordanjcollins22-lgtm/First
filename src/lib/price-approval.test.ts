import { describe, expect, it } from "vitest";

import { priceBreakdown, readPrice, spreadPrice } from "./price-approval";

const zone = (price: number | null) => ({ zoneName: "A", serviceLabel: "Beds", scopeText: "", photoPaths: [], points: [], color: "#000", priceCents: price });

describe("a price typed in by hand", () => {
  it("is spread across the areas by their share, and adds up exactly", () => {
    const spread = spreadPrice([zone(60000), zone(30000), zone(10000)], 1234.56);
    expect(spread.map((z) => z.priceCents)).toEqual([74074, 37037, 12345]);
    expect(spread.reduce((sum, z) => sum + (z.priceCents ?? 0), 0)).toBe(123456);
    expect(spread.every((z) => z.priceDerived === false)).toBe(true);
  });

  it("is split evenly when no area had a price", () => {
    expect(spreadPrice([zone(null), zone(null)], 500).map((z) => z.priceCents)).toEqual([25000, 25000]);
  });

  it("reads dollars however they are typed", () => {
    expect(readPrice("$2,450")).toBe(2450);
    expect(readPrice(" 1999.5 ")).toBe(1999.5);
    expect(readPrice("0")).toBeNull();
    expect(readPrice("abc")).toBeNull();
  });
});

describe("what is behind the price", () => {
  const catalog = {
    servicePricing: [
      { service_type_id: "landscape-bed", name: "Landscape Bed", status: "active", pricing_basis: "area", minutes_per_sqft: 0.3, estimated_hours: null, crew_size: 1 },
      { service_type_id: "soft-washing", name: "Soft Washing", status: "active", pricing_basis: "flat", minutes_per_sqft: null, estimated_hours: null, crew_size: 1 },
    ] as never,
    serviceMaterialRules: [{ id: "r", service_type_id: "landscape-bed", material_id: "m", match_field: "material", match_value: "Mulch", created_at: "" }],
    materials: [{ id: "m", name: "Mulch", unit: "cubic yards", coverage_per_unit_sqft: 100, waste_factor_pct: 0, cost_per_unit: 40 }] as never,
    crewCostPerHourCents: 3000,
    markup: { multiplier: 2, overheadPercent: 10, overheadPerCrewHourCents: null },
  };
  const z = (name: string, typeId: string, area: number | null, values: Record<string, string> = {}) =>
    ({ id: name, name, color: "#000", points: [], location: "", service: { typeId, values, notes: "", photos: [], tools: [] }, areaSqFt: area, perimeterFt: null }) as never;

  it("adds up hours, labour, materials and markup, area by area", () => {
    const b = priceBreakdown([z("Front beds", "landscape-bed", 200, { material: "Mulch" })], catalog);
    const a = b.areas[0];
    expect(a.service).toBe("Landscape Bed");
    expect(a.crewHours).toBeCloseTo(1, 5); // 200 sq ft at 0.3 min
    expect(a.labourCents).toBe(3000);
    expect(a.materialsCents).toBe(8000); // 2 yards at $40
    expect(a.labourCents + a.materialsCents + a.markupCents).toBe(a.priceCents);
    expect(b.priceCents).toBe(a.priceCents);
    expect(b.warnings).toEqual([]);
  });

  it("says when a service has no crew time or an area no measurement", () => {
    const b = priceBreakdown([z("House", "soft-washing", null)], catalog);
    expect(b.warnings.join(" ")).toMatch(/No crew time on the rate card for Soft Washing/);
    expect(b.warnings.join(" ")).toMatch(/no measurement/);
  });
});
