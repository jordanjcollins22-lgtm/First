import { describe, expect, it } from "vitest";

import { margin, priceBreakdown, priceForTarget, readPrice, spreadPrice } from "./price-approval";

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
    expect(b.materialTotals).toEqual([{ name: "Mulch", amount: "2.0 cubic yards", cents: 8000 }]);
    expect(b.warnings).toEqual([]);
  });

  it("adds up the same material across areas", () => {
    const b = priceBreakdown(
      [z("Front", "landscape-bed", 200, { material: "Mulch" }), z("Back", "landscape-bed", 300, { material: "Mulch" })],
      catalog
    );
    expect(b.materialTotals).toEqual([{ name: "Mulch", amount: "5.0 cubic yards", cents: 20000 }]);
  });

  it("says when a service has no crew time or an area no measurement", () => {
    const b = priceBreakdown([z("House", "soft-washing", null)], catalog);
    expect(b.warnings.join(" ")).toMatch(/No crew time on the rate card for Soft Washing/);
    expect(b.warnings.join(" ")).toMatch(/no measurement/);
  });
});

describe("margin", () => {
  it("takes labour, materials and the fee off the price", () => {
    // $1,000 job: $200 labour, $100 materials, 15% to the account manager.
    const m = margin(100_000, 20_000, 10_000, 15);
    expect(m.feeCents).toBe(15_000);
    expect(m.costCents).toBe(45_000);
    expect(m.grossCents).toBe(55_000);
    expect(m.grossPct).toBeCloseTo(0.55);
    expect(m.meetsTarget).toBe(true);
    expect(margin(60_000, 20_000, 10_000, 15).meetsTarget).toBe(false);
  });

  it("works out the price that leaves 50%, rounded up to the dollar", () => {
    // $300 of labour and materials, 15% fee: 300 / 0.35 = $857.14, so $858.
    const floor = priceForTarget(20_000, 10_000, 15)!;
    expect(floor).toBe(85_800);
    expect(margin(floor, 20_000, 10_000, 15).grossPct).toBeGreaterThanOrEqual(0.5);
    // A fee of half or more leaves no price that works.
    expect(priceForTarget(20_000, 10_000, 50)).toBeNull();
    // Three salting visits: a round price a visit. $49.62 of cost at 15%
    // needs $141.77, so $48 a visit, $144.
    expect(priceForTarget(4_002, 960, 15, 0.5, 3)).toBe(14_400);
  });
});

describe("spreadPrice on salting", () => {
  it("brings salting's own words to the new price", () => {
    const zone = {
      zoneName: "Zone 1",
      color: "#000",
      points: [],
      serviceLabel: "Salting (prepaid)",
      scopeText: "Pre-paid salting: 3 treatments at $40 each, $120 in all, on the driveway. Three treatments is the minimum to book.",
      priceCents: 12000,
    } as unknown as Parameters<typeof spreadPrice>[0][number];
    const [out] = spreadPrice([zone], 142);
    expect(out.priceCents).toBe(14200);
    expect(out.scopeText).toBe("Pre-paid salting: 3 treatments at $47.33 each, $142 in all, on the driveway. Three treatments is the minimum to book.");
  });
});
