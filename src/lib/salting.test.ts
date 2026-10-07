import { describe, expect, it } from "vitest";

import { costSalting, priceSaltingVisits, priceSaltingVisitsTogether, repriceSaltingScope, saltingMaterial, saltingOrder, saltingScope } from "./salting";
import { DEFAULT_SALT_SETTINGS, quoteOrder } from "./salt";
import { margin } from "./gross-profit";

describe("salting off the site map", () => {
  it("costs exactly what the salt page charges for the same order", () => {
    const values = { surface: "Driveway and walkways", treatments: "3", petSafe: "No" };
    const cost = costSalting(values);
    expect(cost.priceCents).toBe(quoteOrder({ surface: "both", petFriendly: false, treatments: 3 }).totalCents);
    expect(cost.priceCents).toBe(15_000);
    expect(cost.materialsCents + cost.labourCents).toBeLessThan(cost.priceCents);
  });

  it("holds the order to three treatments", () => {
    expect(saltingOrder({ treatments: "1" }).treatments).toBe(3);
    expect(saltingOrder({}).treatments).toBe(3);
    expect(saltingOrder({ treatments: "6" }).treatments).toBe(6);
  });

  it("names the salt to buy ahead for every treatment sold", () => {
    const salt = saltingMaterial({ surface: "Driveway", treatments: "4", petSafe: "Yes" });
    expect(salt.name).toBe("Pet friendly snow melt (calcium chloride)");
    expect(salt.pounds).toBe(20);
    expect(salt.bags).toBe(1);
  });

  it("tells the client the minimum and that it is paid up front", () => {
    const text = saltingScope({ surface: "Sidewalks and walkways", treatments: "3" });
    expect(text).toMatch(/3 applications included in this quote, at \$25 each, \$75 in all, on the sidewalks and walkways/);
    expect(text).toMatch(/Three applications is the minimum to book/);
    expect(text).toMatch(/paid up front/);
  });
});

describe("salting a visit at a time", () => {
  const settings = { ...DEFAULT_SALT_SETTINGS, bagCostCents: 3200, bagPounds: 50, drivewayPounds: 5, drivewayMinutes: 15, sidewalkMinutes: 5 };
  const trip = { toSiteMinutes: 20, fromSiteMinutes: 22, crewCostPerHourCents: 2667, feePct: 15 };

  it("charges the visit in whole hours, the drive from the shop and back included", () => {
    const v = priceSaltingVisits({ surface: "Driveway", treatments: "3" }, settings, trip);
    // 15 minutes on site and 42 in the truck: an hour.
    expect(v.onSiteMinutes).toBe(15);
    expect(v.travelMinutes).toBe(42);
    expect(v.billedHours).toBe(1);
    expect(v.labourCents).toBe(2667);
  });

  it("never leaves under 50% gross profit a visit after the fee", () => {
    const v = priceSaltingVisits({ surface: "Driveway", treatments: "3" }, settings, trip);
    expect(margin(v.perVisitCents, v.labourCents, v.materialCents, 15).grossPct).toBeGreaterThanOrEqual(0.5);
    expect(v.lifted).toBe(true);
    expect(v.perVisitCents % 100).toBe(0);
    expect(v.totalCents).toBe(v.perVisitCents * 3);
  });

  it("puts the new price in its words", () => {
    const text = saltingScope({ surface: "Driveway", treatments: "3" }, settings);
    expect(repriceSaltingScope(text, 26_400)).toMatch(/^Pre-paid salting: 3 applications included in this quote, at \$88 each, \$264 in all, on the driveway\./);
    expect(saltingScope({ surface: "Driveway", treatments: "3" }, settings, 8800)).toMatch(/at \$88 each, \$264 in all/);
    expect(saltingScope({ surface: "Driveway", treatments: "3" }, settings)).toMatch(/store again until the next one, for up to 2 years\. Storage is included in the price\./);
    // Words written before still reprice.
    expect(repriceSaltingScope("Pre-paid salting: 3 treatments at $40 each, $120 in all, on the driveway.", 27_000)).toMatch(/^Pre-paid salting: 3 applications included in this quote, at \$90 each, \$270 in all/);
  });

  it("calls the pet blend a pet friendly snow melt on the proposal", () => {
    expect(saltingScope({ surface: "Driveway", treatments: "3", petSafe: "Yes" })).toMatch(/Each application is a pet friendly snow melt, never rock salt/);
    expect(saltingScope({ surface: "Driveway", treatments: "3", petSafe: "No" })).toMatch(/Each application is calcium chloride/);
  });
});

describe("salting several areas on one property", () => {
  const settings = { ...DEFAULT_SALT_SETTINGS, bagCostCents: 3200, bagPounds: 50, drivewayPounds: 5, drivewayMinutes: 15, sidewalkMinutes: 20 };
  const trip = { toSiteMinutes: 21, fromSiteMinutes: 20, crewCostPerHourCents: 2667, feePct: 15 };
  const lane = { surface: "Driveway", treatments: "3" };
  const walk = { surface: "Sidewalks and walkways", treatments: "3", petSafe: "Yes" };

  it("drives there and back once a visit, not once an area", () => {
    const areas = [lane, walk, walk, lane, lane];
    const priced = priceSaltingVisitsTogether(areas, settings, trip);
    const visit = priced[0]!.visit!;
    expect(priced.every((p) => p!.visit === visit)).toBe(true);
    expect(visit.areas).toBe(5);
    expect(visit.travelMinutes).toBe(41);
    // Three driveway areas at 30 min and two walks at 20: 130 min on site, 41 in the truck, 3 hours on the clock.
    expect(visit.onSiteMinutes).toBe(130);
    expect(visit.billedHours).toBe(3);
    // The areas' shares add back up to the one visit, so nothing is counted twice.
    expect(priced.reduce((sum, p) => sum + p!.labourCents, 0)).toBe(visit.labourCents);
    expect(priced.reduce((sum, p) => sum + p!.travelMinutes, 0)).toBe(41);
    expect(priced.reduce((sum, p) => sum + p!.billedHours, 0)).toBeCloseTo(3, 6);
    // Priced a trip an area, each would be its own drive and two hours on the clock: ten hours a visit.
    const apart = areas.map((a) => priceSaltingVisits(a, settings, trip));
    expect(apart.reduce((sum, p) => sum + p.labourCents, 0)).toBe(10 * 2667);
    expect(visit.labourCents).toBe(3 * 2667);
  });

  it("holds every area to 50% after the fee on its share", () => {
    for (const p of priceSaltingVisitsTogether([lane, walk, lane], settings, trip)) {
      expect(margin(p!.perVisitCents, p!.labourCents, p!.materialCents, 15).grossPct).toBeGreaterThanOrEqual(0.5);
    }
  });

  it("prices a lone area, or one not salting, as before", () => {
    const [only, none] = priceSaltingVisitsTogether([lane, null], settings, trip);
    expect(only).toEqual(priceSaltingVisits(lane, settings, trip));
    expect(none).toBeNull();
  });

  it("shares a trip only between areas on the same number of treatments", () => {
    const [three, six] = priceSaltingVisitsTogether([lane, { ...lane, treatments: "6" }], settings, trip);
    expect(three!.visit).toBeUndefined();
    expect(six!.visit).toBeUndefined();
    expect(three!.travelMinutes).toBe(41);
    expect(six!.travelMinutes).toBe(41);
  });
});
