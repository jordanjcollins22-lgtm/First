import { describe, expect, it } from "vitest";

import { PRICING_EQUATION, PRODUCTION_SERVICES } from "@/lib/forward-pricing";
import type { InstantWork } from "@/lib/instant-price";
import type { Supplier } from "@/lib/material-suppliers";
import { equationWithTeamPay, forwardLinesFor, forwardRuleWords, priceWorksForward, type ForwardSetup } from "@/lib/spot-forward";

const bed = (sqft: number): InstantWork => ({ service: "beds", label: "Spot 1: bed prep and fresh mulch", typeId: "landscape-bed", areaSqft: sqft, values: { material: "Mulch" } });

const lehnhoffs: Supplier = {
  id: "s1",
  name: "Lehnhoff's Supply",
  address: null,
  lat: 39.5,
  lng: -76.35,
  phone: null,
  website: null,
  delivers: false,
  deliveryMinimum: null,
  deliveryFees: [],
  deliveryNote: null,
  notes: null,
  sourceUrl: null,
  checkedOn: null,
  active: true,
  products: [
    { id: "p1", kind: "mulch", name: "Natural triple shredded mulch", unit: "yd", priceCents: 3700, deliveredPriceCents: null, imageUrl: null, productUrl: null, checkedOn: null },
    { id: "p2", kind: "mulch", name: "Dyed black mulch", unit: "yd", priceCents: 4200, deliveredPriceCents: null, imageUrl: null, productUrl: null, checkedOn: null },
  ],
};

// The live business: no saved settings, so the team's pay ($30, $25, $25) on a crew of two.
const equation = equationWithTeamPay(PRICING_EQUATION, [30, 25, 25], 2);
const setup: ForwardSetup = { equation, services: PRODUCTION_SERVICES, suppliers: [lehnhoffs], site: { lat: 39.44, lng: -76.37, zip: "21085" }, driveMinutesPerDay: null };

describe("equationWithTeamPay", () => {
  it("leads with the best-paid and pays the rest of the crew the others' average", () => {
    expect(equation).toMatchObject({ leads: 1, leadRateCents: 3000, technicians: 1, technicianRateCents: 2500 });
  });

  it("keeps the equation when nobody has hourly pay", () => {
    expect(equationWithTeamPay(PRICING_EQUATION, [], 2)).toBe(PRICING_EQUATION);
  });

  it("sizes the crew from the business's crew size", () => {
    expect(equationWithTeamPay(PRICING_EQUATION, [30, 25], 3).technicians).toBe(2);
  });
});

describe("forwardLinesFor", () => {
  it("spreads a bed's mulch two inches deep, to the next half yard", () => {
    // 204 sq ft at 2 in is 1.26 yd: 1.5 yd.
    expect(forwardLinesFor(bed(204), PRODUCTION_SERVICES)).toMatchObject([{ key: "mulch-install", quantity: 1.5 }]);
  });

  it("weeds under a new bed at half the area's time", () => {
    const weeds: InstantWork = { service: "cleanup", label: "x", typeId: "landscape-cleanup", areaSqft: 200, hoursFactor: 0.5 };
    expect(forwardLinesFor(weeds, PRODUCTION_SERVICES)).toMatchObject([{ key: "weed-pulling", quantity: 100 }]);
  });

  it("counts bushes, and prices plants as planting only", () => {
    expect(forwardLinesFor({ service: "cleanup", label: "x", typeId: "trimming", count: 4 }, PRODUCTION_SERVICES)).toMatchObject([{ key: "shrub-trimming", quantity: 4 }]);
    expect(forwardLinesFor({ service: "beds", label: "x", typeId: "plant-installation", count: 5 }, PRODUCTION_SERVICES)).toMatchObject([{ key: "plant-install-1gal", quantity: 5, materialCents: 0 }]);
  });

  it("has nothing for work priced at the visit", () => {
    expect(forwardLinesFor({ service: "hardscape", label: "x", typeId: null }, PRODUCTION_SERVICES)).toEqual([]);
  });
});

describe("priceWorksForward", () => {
  it("prices a bed at the supplier's mulch, the production rate and the equation's margin", () => {
    const [line] = priceWorksForward([bed(204)], setup);
    // 1.5 yd of the supplier's best fit for mulch.
    expect(line!.materialsCents).toBeGreaterThan(5000);
    expect(line!.materials[0]).toMatchObject({ name: "Mulch", typical: false });
    // 1.5 yd at 2.5 yd a crew-hour is 0.6 crew-hours of work. At 75% of the
    // day on the job, the time off it is a third as much again: 0.8 in all.
    expect(line!.crewHours).toBeCloseTo(0.8, 2);
    // At $55 a crew-hour.
    expect(line!.labourCents).toBe(Math.round(0.8 * 5500));
    // Price is cost ÷ 0.35, so gross profit is half the price.
    const cost = line!.labourCents + line!.materialsCents;
    expect(line!.priceCents).toBeCloseTo(cost / 0.35, -1);
    expect(line!.markupCents).toBe(line!.priceCents! - cost);
  });

  it("shares the job's time off the work over its pieces by their hours", () => {
    const one = priceWorksForward([bed(204)], setup)[0]!;
    const three = priceWorksForward([bed(204), bed(204), bed(204)], setup);
    expect(three.every((l) => l!.priceCents === three[0]!.priceCents)).toBe(true);
    // Three beds order 4.5 yards at once, so each is within a dollar or two of one alone.
    expect(Math.abs(three[0]!.priceCents! - one.priceCents!)).toBeLessThan(300);
  });

  it("leaves work it has no service for to the caller", () => {
    expect(priceWorksForward([{ service: "hardscape", label: "x", typeId: null }], setup)).toEqual([null]);
  });

  it("falls back to the service's own mulch cost with no supplier", () => {
    const [line] = priceWorksForward([bed(204)], { ...setup, suppliers: [] });
    expect(line!.materials[0]).toMatchObject({ typical: true, cents: 5250 });
  });
});

describe("forwardRuleWords", () => {
  it("says the rule", () => {
    expect(forwardRuleWords(PRICING_EQUATION)).toBe("cost ÷ 0.35: 50% gross profit, 15% commissions");
  });
});
