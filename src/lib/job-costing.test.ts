import { describe, expect, it } from "vitest";

import {
  blendedCrewRateCents,
  effectiveMultiplier,
  priceJob,
  priceZone,
  type Markup,
} from "@/lib/job-costing";

/** The business's own: times two, then ten percent on top. */
const HOUSE: Markup = { multiplier: 2, overheadPercent: 10 };

describe("priceZone", () => {
  it("adds labour to materials to get what it costs us", () => {
    const cost = priceZone(
      { materialsCents: 10_000, crewHours: 3, crewCostPerHourCents: 5_000 },
      HOUSE
    );
    expect(cost.materialsCents).toBe(10_000);
    expect(cost.labourCents).toBe(15_000);
    expect(cost.directCostCents).toBe(25_000);
  });

  it("charges the overhead on the marked-up figure, not the raw cost", () => {
    // $250 of cost. Times two is $500, plus ten percent of $500 is $550.
    // Charging the ten percent on the cost instead would quote $525.
    const cost = priceZone(
      { materialsCents: 10_000, crewHours: 3, crewCostPerHourCents: 5_000 },
      HOUSE
    );
    expect(cost.priceCents).toBe(55_000);
  });

  it("breaks the price into parts that add back up to it", () => {
    const cost = priceZone(
      { materialsCents: 7_333, crewHours: 2.5, crewCostPerHourCents: 4_250 },
      HOUSE
    );
    expect(cost.directCostCents + cost.marginCents + cost.overheadCents).toBe(cost.priceCents);
  });

  it("prices a zone with no materials on its labour alone", () => {
    const cost = priceZone({ materialsCents: 0, crewHours: 2, crewCostPerHourCents: 5_000 }, HOUSE);
    expect(cost.directCostCents).toBe(10_000);
    expect(cost.priceCents).toBe(22_000);
  });

  it("prices a supply-only zone on its materials alone", () => {
    const cost = priceZone({ materialsCents: 10_000, crewHours: 0, crewCostPerHourCents: 5_000 }, HOUSE);
    expect(cost.directCostCents).toBe(10_000);
    expect(cost.priceCents).toBe(22_000);
  });

  it("costs nothing when there is nothing to do", () => {
    const cost = priceZone({ materialsCents: 0, crewHours: 0, crewCostPerHourCents: 5_000 }, HOUSE);
    expect(cost.priceCents).toBe(0);
    expect(cost.directCostCents).toBe(0);
  });

  it("counts crew-hours, so a bigger crew costs more for the same job", () => {
    // The caller multiplies by crew size; this just has to spend what it is
    // given rather than quietly treating hours as clock time.
    const one = priceZone({ materialsCents: 0, crewHours: 2, crewCostPerHourCents: 5_000 }, HOUSE);
    const three = priceZone({ materialsCents: 0, crewHours: 6, crewCostPerHourCents: 5_000 }, HOUSE);
    expect(three.labourCents).toBe(one.labourCents * 3);
  });

  it("returns whole cents from fractional hours", () => {
    const cost = priceZone(
      { materialsCents: 3_333, crewHours: 1.37, crewCostPerHourCents: 4_167 },
      HOUSE
    );
    for (const value of Object.values(cost)) expect(Number.isInteger(value)).toBe(true);
  });

  it("never lets a negative input make a negative cost", () => {
    const cost = priceZone({ materialsCents: -500, crewHours: -2, crewCostPerHourCents: 5_000 }, HOUSE);
    expect(cost.materialsCents).toBe(0);
    expect(cost.labourCents).toBe(0);
    expect(cost.priceCents).toBe(0);
  });

  it("quotes cost when there is no markup set", () => {
    const cost = priceZone(
      { materialsCents: 10_000, crewHours: 0, crewCostPerHourCents: 0 },
      { multiplier: 1, overheadPercent: 0 }
    );
    expect(cost.priceCents).toBe(10_000);
    expect(cost.marginCents).toBe(0);
    expect(cost.overheadCents).toBe(0);
  });

  it("takes the multiplier and the overhead as given, whatever they are", () => {
    const flat = priceZone(
      { materialsCents: 10_000, crewHours: 0, crewCostPerHourCents: 0 },
      { multiplier: 2.1, overheadPercent: 0 }
    );
    expect(flat.priceCents).toBe(21_000);
  });
});

describe("priceJob", () => {
  it("is the sum of its zones, part by part", () => {
    const zones = [
      priceZone({ materialsCents: 10_000, crewHours: 3, crewCostPerHourCents: 5_000 }, HOUSE),
      priceZone({ materialsCents: 4_000, crewHours: 1.5, crewCostPerHourCents: 5_000 }, HOUSE),
    ];
    const job = priceJob(zones);
    expect(job.materialsCents).toBe(14_000);
    expect(job.labourCents).toBe(22_500);
    expect(job.priceCents).toBe(zones[0].priceCents + zones[1].priceCents);
  });

  it("is zero for a job with no zones", () => {
    expect(priceJob([]).priceCents).toBe(0);
  });

  it("still adds up part by part after rounding", () => {
    const zones = [7_333, 1_111, 9_999].map((materialsCents) =>
      priceZone({ materialsCents, crewHours: 1.37, crewCostPerHourCents: 4_167 }, HOUSE)
    );
    const job = priceJob(zones);
    expect(job.directCostCents + job.marginCents + job.overheadCents).toBe(job.priceCents);
  });
});

describe("effectiveMultiplier", () => {
  it("reads times two plus ten percent as 2.2", () => {
    expect(effectiveMultiplier(HOUSE)).toBeCloseTo(2.2, 10);
  });

  it("is 1 when nothing is marked up", () => {
    expect(effectiveMultiplier({ multiplier: 1, overheadPercent: 0 })).toBe(1);
  });
});

describe("blendedCrewRateCents", () => {
  const hourly = (ratePerHour: number | null) => ({ payType: "hourly", ratePerHour });

  it("averages the hourly team's pay", () => {
    expect(blendedCrewRateCents([hourly(20), hourly(30)], null)).toBe(2_500);
  });

  it("leaves commission-only people out, so the rate is not dragged down", () => {
    const team = [hourly(20), hourly(30), { payType: "commission", ratePerHour: null }];
    expect(blendedCrewRateCents(team, null)).toBe(2_500);
  });

  it("counts somebody paid both ways, because they are still paid by the hour", () => {
    expect(blendedCrewRateCents([{ payType: "both", ratePerHour: 40 }], null)).toBe(4_000);
  });

  it("ignores an hourly person whose pay has not been entered", () => {
    expect(blendedCrewRateCents([hourly(20), hourly(null)], null)).toBe(2_000);
  });

  it("falls back to the organization's figure when no pay is entered", () => {
    expect(blendedCrewRateCents([hourly(null)], 25)).toBe(2_500);
  });

  it("falls back for an empty team", () => {
    expect(blendedCrewRateCents([], 25)).toBe(2_500);
  });

  it("is zero when nobody has set anything, rather than a guess", () => {
    expect(blendedCrewRateCents([], null)).toBe(0);
  });

  it("prefers real pay over a stale manual figure", () => {
    expect(blendedCrewRateCents([hourly(30)], 12)).toBe(3_000);
  });

  it("returns whole cents from an average that does not divide", () => {
    const rate = blendedCrewRateCents([hourly(20), hourly(21), hourly(23)], null);
    expect(Number.isInteger(rate)).toBe(true);
    expect(rate).toBe(2_133);
  });
});
