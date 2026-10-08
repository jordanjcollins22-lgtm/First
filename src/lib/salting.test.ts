import { describe, expect, it } from "vitest";

import { costSalting, priceSaltingTogether, priceSaltingVisits, repriceSaltingScope, saltingMaterial, saltingOrder, saltingScope } from "./salting";
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
    expect(text).toMatch(/3 applications included in this quote, \$75 in all, on the sidewalks and walkways/);
    expect(text).toMatch(/Three applications is the minimum to book/);
    expect(text).toMatch(/paid up front/);
  });
});

describe("salting a visit at a time", () => {
  const settings = { ...DEFAULT_SALT_SETTINGS, bagCostCents: 3200, bagPounds: 50, drivewayPounds: 5, drivewayMinutes: 15, sidewalkMinutes: 5 };
  const trip = { toSiteMinutes: 20, fromSiteMinutes: 22, crewCostPerHourCents: 2667, feePct: 15 };

  it("charges the visit in whole hours, the drive from the shop and back included", () => {
    const v = priceSaltingVisits({ surface: "Driveway", treatments: "3" }, settings, trip);
    // 10 minutes on the ground and 42 in the truck: an hour.
    expect(v.onSiteMinutes).toBe(10);
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

  it("salts every area at the house on the one visit: one drive, one hour's minimum", () => {
    const areas = [{ surface: "Driveway", treatments: "3" }, { surface: "Sidewalks and walkways", treatments: "3" }, { surface: "Sidewalks and walkways", treatments: "3" }];
    const near = { ...trip, toSiteMinutes: 10, fromSiteMinutes: 10 };
    const together = priceSaltingTogether(areas, settings, near);
    const apart = areas.map((a) => priceSaltingVisits(a, settings, near));
    // Under 40 minutes on site and 20 in the truck: one hour, shared.
    expect(together.reduce((sum, v) => sum + v.onSiteMinutes, 0)).toBeLessThanOrEqual(40);
    expect(together[0].visitBilledHours).toBe(1);
    expect(together.reduce((sum, v) => sum + v.labourCents, 0)).toBe(2667);
    expect(together.reduce((sum, v) => sum + v.billedHours, 0)).toBeCloseTo(1);
    const total = (vs: { totalCents: number }[]) => vs.reduce((sum, v) => sum + v.totalCents, 0);
    expect(total(together)).toBeLessThan(total(apart));
    for (const v of together) expect(v.perVisitCents).toBeGreaterThanOrEqual(v.saltPageCents);
  });

  it("puts the new price in its words", () => {
    const text = saltingScope({ surface: "Driveway", treatments: "3" }, settings);
    expect(repriceSaltingScope(text, 26_400)).toMatch(/^Pre-paid salting: 3 applications included in this quote, \$264 in all, on the driveway\./);
    expect(saltingScope({ surface: "Driveway", treatments: "3" }, settings, 8800)).toMatch(/quote, \$264 in all/);
    expect(saltingScope({ surface: "Driveway", treatments: "3" }, settings)).toMatch(/store again until the next one, for up to 2 years\. Storage is included in the price\./);
    // Words written before still reprice.
    expect(repriceSaltingScope("Pre-paid salting: 3 treatments at $40 each, $120 in all, on the driveway.", 27_000)).toMatch(/^Pre-paid salting: 3 applications included in this quote, \$270 in all/);
  });

  it("calls the pet blend a pet friendly snow melt on the proposal", () => {
    expect(saltingScope({ surface: "Driveway", treatments: "3", petSafe: "Yes" })).toMatch(/Each application is a pet friendly snow melt, never rock salt/);
    expect(saltingScope({ surface: "Driveway", treatments: "3", petSafe: "No" })).toMatch(/Each application is calcium chloride/);
  });
});
