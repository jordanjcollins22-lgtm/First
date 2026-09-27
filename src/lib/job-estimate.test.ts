import { describe, expect, it } from "vitest";

import { buildEstimate, withTravelShare } from "@/lib/job-estimate";

const markup = { multiplier: 2, overheadPercent: 10, overheadPerCrewHourCents: null };

const beds = {
  name: "Front beds",
  service: "Landscape Bed",
  sizeLabel: "240 sq ft",
  crewHours: 6,
  crewSize: 2,
  missingTiming: false,
  materials: [{ name: "Black mulch", quantityLabel: "3 cu yd", costCents: 12600 }],
  priceCents: 50000,
};
const removal = { ...beds, name: "Side yard", service: "Plant / Bush Removal", crewHours: 4, crewSize: 2, materials: [], priceCents: 20000 };
const travel = { toSiteMinutes: 25, fromSiteMinutes: 27, pickupExtraMinutes: 15, from: "THE SHOP", pickupFrom: "Lehnhoff's", notes: [] };

describe("the estimate behind a proposal", () => {
  it("turns crew-hours into hours on the clock, a crew and days", () => {
    const e = buildEstimate({ zones: [beds, removal], travel, crewCostPerHourCents: 3000, markup });
    expect(e.zones.map((z) => z.hours)).toEqual([3, 2]);
    expect(e.crew).toBe(2);
    expect(e.onSiteHours).toBe(5);
    expect(e.days).toBe(1);
  });

  it("counts the drive both ways every day, and the pickup once, for the whole crew", () => {
    const e = buildEstimate({ zones: [{ ...beds, crewHours: 40 }], travel, crewCostPerHourCents: 3000, markup });
    // 20 hours on the clock is 3 days: (25 + 27) × 3 days × 2 people + 15 × 2, in hours.
    expect(e.days).toBe(3);
    expect(e.travel.crewHours).toBeCloseTo((52 * 3 * 2 + 30) / 60, 1);
    expect(e.travel.pickupMinutes).toBe(15);
  });

  it("leaves the pickup out when nothing is being bought", () => {
    const e = buildEstimate({ zones: [removal], travel, crewCostPerHourCents: 3000, markup });
    expect(e.travel.pickupMinutes).toBe(0);
    expect(e.travel.pickupFrom).toBeNull();
  });

  it("adds up costs, and prices travel with the same markup", () => {
    const e = buildEstimate({ zones: [beds, removal], travel, crewCostPerHourCents: 3000, markup });
    expect(e.costs.onSiteLabourCents).toBe(10 * 3000);
    expect(e.costs.materialsCents).toBe(12600);
    expect(e.costs.travelLabourCents).toBe(Math.round(e.travel.crewHours * 3000));
    expect(e.travelPriceCents).toBe(Math.round(e.costs.travelLabourCents * 2 * 1.1));
    expect(e.priceCents).toBe(70000 + e.travelPriceCents);
  });

  it("says what it had to assume, and what is missing", () => {
    const e = buildEstimate({
      zones: [{ ...beds, missingTiming: true, materials: [{ name: "Edging", quantityLabel: "40 ft", costCents: null }] }],
      travel: { ...travel, toSiteMinutes: null, fromSiteMinutes: null, pickupExtraMinutes: null },
      crewCostPerHourCents: 0,
      markup,
    });
    expect(e.travel.toSiteMinutes).toBe(30);
    expect(e.travel.notes.join(" ")).toMatch(/assumed/);
    expect(e.warnings.join(" ")).toMatch(/No crew rate/);
    expect(e.warnings.join(" ")).toMatch(/No timing on the service for Front beds/);
    expect(e.warnings.join(" ")).toMatch(/No cost recorded for Edging/);
  });
});

describe("sharing travel across the areas", () => {
  it("adds up exactly to the areas plus travel", () => {
    const shared = withTravelShare([50000, 20000, 10000], 9999);
    expect(shared.reduce((a, b) => a + b, 0)).toBe(80000 + 9999);
    expect(shared[0]).toBeGreaterThan(shared[1]);
  });

  it("splits evenly when the areas have no price", () => {
    expect(withTravelShare([0, 0], 100)).toEqual([50, 50]);
    expect(withTravelShare([], 100)).toEqual([]);
  });
});
