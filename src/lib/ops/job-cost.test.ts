import { describe, expect, it } from "vitest";

import { budgetMeter, costSnapshot, labourCents } from "./job-cost";

describe("labourCents", () => {
  it("uses each person's own rate and the fallback for anyone without one", () => {
    const out = labourCents(
      [
        { profileId: "a", hours: 4, rateCents: 2500 },
        { profileId: "b", hours: 2, rateCents: null },
        { profileId: "c", hours: 0, rateCents: null },
      ],
      2000
    );
    expect(out.cents).toBe(4 * 2500 + 2 * 2000);
    // c worked no hours, so their missing rate does not matter.
    expect(out.estimatedRates).toBe(1);
  });

  it("adds the burden on top of wages", () => {
    expect(labourCents([{ profileId: "a", hours: 10, rateCents: 2000 }], 0, 20).cents).toBe(24000);
  });
});

describe("costSnapshot", () => {
  const base = {
    revenueCents: 300_000,
    budgetHours: 20,
    people: [
      { profileId: "a", hours: 12, rateCents: 2500 },
      { profileId: "b", hours: 10, rateCents: 2000 },
    ],
    fallbackRateCents: 2200,
    burdenPct: 0,
    materialsCents: 80_000,
    otherCents: 5_000,
    overBudgetPct: 10,
  };

  it("works out margin, efficiency and revenue per crew-hour", () => {
    const s = costSnapshot(base);
    expect(s.actualHours).toBe(22);
    expect(s.labourCents).toBe(12 * 2500 + 10 * 2000);
    expect(s.directCostCents).toBe(50_000 + 80_000 + 5_000);
    expect(s.grossMarginCents).toBe(300_000 - 135_000);
    expect(s.grossMarginPct).toBe(55);
    expect(s.efficiencyPct).toBe(90.9);
    expect(s.hoursVariancePct).toBe(10);
    expect(s.revenuePerCrewHourCents).toBe(Math.round(300_000 / 22));
    // Exactly 10% over is not more than 10% over.
    expect(s.overBudget).toBe(false);
  });

  it("flags a job more than the threshold over its hours", () => {
    const s = costSnapshot({ ...base, people: [{ profileId: "a", hours: 23, rateCents: 2500 }] });
    expect(s.hoursVariancePct).toBe(15);
    expect(s.overBudget).toBe(true);
  });

  it("says nothing about budget when there is none", () => {
    const s = costSnapshot({ ...base, budgetHours: null });
    expect(s.efficiencyPct).toBeNull();
    expect(s.overBudget).toBe(false);
  });

  it("has no margin percentage and no rate per hour on nothing", () => {
    const s = costSnapshot({ ...base, revenueCents: 0, people: [] });
    expect(s.grossMarginPct).toBeNull();
    expect(s.revenuePerCrewHourCents).toBeNull();
  });
});

describe("budgetMeter", () => {
  it("shows hours left, and warns near the end", () => {
    expect(budgetMeter(10, 4)).toMatchObject({ remainingHours: 6, tone: "good", line: "6h left of 10h budgeted." });
    expect(budgetMeter(10, 9)).toMatchObject({ tone: "warn" });
  });
  it("says how far over", () => {
    expect(budgetMeter(10, 12.5)).toMatchObject({ tone: "over", line: "2.5h over the 10h budgeted." });
  });
  it("copes with no budget", () => {
    expect(budgetMeter(null, 3)).toMatchObject({ tone: "unknown", remainingHours: null });
  });
});
