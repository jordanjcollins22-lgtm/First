import { describe, expect, it } from "vitest";

import {
  affordability,
  towShortfalls,
  failureChanceWithin,
  fleetWeeklyRiskCost,
  monthlySwap,
  percent,
  rankRisk,
  tradeInCents,
  upfrontCents,
  weeklyRiskCost,
  yearlyFailureChance,
  type FleetAsset,
  type FleetTarget,
} from "@/lib/fleet";

const TODAY = new Date("2026-09-10T12:00:00Z");

function asset(over: Partial<FleetAsset> = {}): FleetAsset {
  return {
    id: "a1",
    name: "The Titan",
    kind: "truck",
    year: 2004,
    make: "Nissan",
    model: "Titan",
    mileage: null,
    condition: "failing",
    breakdowns12mo: 0,
    lastBreakdownOn: null,
    monthlyCost: null,
    resaleValue: null,
    towRatingLb: null,
    notes: null,
    retiredOn: null,
    ...over,
  };
}

function target(over: Partial<FleetTarget> = {}): FleetTarget {
  return {
    id: "t1",
    name: "Cybertruck",
    kind: "truck",
    costCents: 7_999_000,
    depositCents: 1_000_000,
    monthlyCents: 120_000,
    replacesAssetId: null,
    priority: 1,
    towRatingLb: null,
    url: null,
    notes: null,
    orderedOn: null,
    boughtOn: null,
    ...over,
  };
}

describe("the chance of being stranded", () => {
  it("is worse for something in worse condition", () => {
    const good = yearlyFailureChance(asset({ condition: "good" }), TODAY);
    const failing = yearlyFailureChance(asset({ condition: "failing" }), TODAY);
    expect(failing).toBeGreaterThan(good);
  });

  it("is worse for something older", () => {
    const old = yearlyFailureChance(asset({ year: 2004, condition: "fair" }), TODAY);
    const newer = yearlyFailureChance(asset({ year: 2022, condition: "fair" }), TODAY);
    expect(old).toBeGreaterThan(newer);
  });

  it("leans hardest on what has actually happened", () => {
    // A truck that has already stranded a crew twice is not a truck with a
    // theoretical problem, and the model should say so louder than age does.
    const quiet = yearlyFailureChance(asset({ condition: "fair", breakdowns12mo: 0 }), TODAY);
    const twice = yearlyFailureChance(asset({ condition: "fair", breakdowns12mo: 2 }), TODAY);
    expect(twice - quiet).toBeGreaterThan(0.25);
  });

  it("never says something is certain to break", () => {
    const worst = yearlyFailureChance(
      asset({ condition: "failing", year: 1985, mileage: 400_000, breakdowns12mo: 9 }),
      TODAY
    );
    expect(worst).toBeLessThan(1);
  });

  it("works on a trailer, which has no odometer", () => {
    expect(yearlyFailureChance(asset({ kind: "trailer", mileage: null }), TODAY)).toBeGreaterThan(0);
  });
});

describe("the chance within a window", () => {
  it("rises with every extra day, which is the whole point", () => {
    const truck = asset();
    const week = failureChanceWithin(truck, 7, TODAY);
    const month = failureChanceWithin(truck, 30, TODAY);
    const quarter = failureChanceWithin(truck, 90, TODAY);
    expect(month).toBeGreaterThan(week);
    expect(quarter).toBeGreaterThan(month);
  });

  it("is nothing over no days at all", () => {
    expect(failureChanceWithin(asset(), 0, TODAY)).toBe(0);
  });

  it("stays below the yearly figure inside a year", () => {
    const truck = asset();
    expect(failureChanceWithin(truck, 364, TODAY)).toBeLessThan(yearlyFailureChance(truck, TODAY));
  });

  it("comes out about the yearly figure over a year", () => {
    const truck = asset();
    expect(failureChanceWithin(truck, 365, TODAY)).toBeCloseTo(yearlyFailureChance(truck, TODAY), 6);
  });
});

describe("what waiting costs", () => {
  it("costs more per week on a truck than on a trailer in the same state", () => {
    // A dead trailer can be worked around. A dead truck takes the week.
    const truck = weeklyRiskCost(asset({ kind: "truck" }), TODAY);
    const trailer = weeklyRiskCost(asset({ kind: "trailer" }), TODAY);
    expect(truck).toBeGreaterThan(trailer);
  });

  it("adds up across everything still in service", () => {
    const total = fleetWeeklyRiskCost(
      [asset({ id: "a" }), asset({ id: "b", kind: "trailer" })],
      TODAY
    );
    expect(total).toBeGreaterThan(weeklyRiskCost(asset({ id: "a" }), TODAY));
  });

  it("ignores anything already retired", () => {
    const total = fleetWeeklyRiskCost([asset({ retiredOn: "2026-01-01" })], TODAY);
    expect(total).toBe(0);
  });

  it("ranks by what it would cost, not by how likely it is", () => {
    // A trailer nearly certain to need a bearing is a smaller problem than a
    // truck that probably will not die but would take the week with it.
    const ranked = rankRisk(
      [asset({ id: "t", kind: "trailer", condition: "failing" }), asset({ id: "k", kind: "truck", condition: "poor" })],
      TODAY
    );
    expect(ranked[0].asset.id).toBe("k");
  });
});

describe("when the money is there", () => {
  it("says today when the money is already there", () => {
    const out = affordability({
      needCents: 1_000_000,
      haveCents: 1_200_000,
      weeklyCents: 50_000,
      riskPerWeekCents: 20_000,
      today: TODAY,
    });
    expect(out.affordableNow).toBe(true);
    expect(out.weeks).toBe(0);
    expect(out.waitingCostCents).toBe(0);
  });

  it("counts the weeks and lands on a date", () => {
    const out = affordability({
      needCents: 1_000_000,
      haveCents: 0,
      weeklyCents: 100_000,
      riskPerWeekCents: 20_000,
      today: TODAY,
    });
    expect(out.weeks).toBe(10);
    expect(out.on).toBe("2026-11-19");
  });

  it("prices the wait, which is the argument for financing it sooner", () => {
    const out = affordability({
      needCents: 1_000_000,
      haveCents: 0,
      weeklyCents: 100_000,
      riskPerWeekCents: 28_000,
      today: TODAY,
    });
    expect(out.waitingCostCents).toBe(280_000);
  });

  it("refuses to invent a date when nothing is coming in", () => {
    // A date built from a weekly figure of zero is a date somebody plans
    // around, and it would never arrive.
    const out = affordability({
      needCents: 1_000_000,
      haveCents: 0,
      weeklyCents: 0,
      riskPerWeekCents: 20_000,
      today: TODAY,
    });
    expect(out.weeks).toBeNull();
    expect(out.on).toBeNull();
  });
});

describe("what has to be found", () => {
  it("takes the deposit where there is one", () => {
    expect(upfrontCents(target())).toBe(1_000_000);
  });

  it("takes the whole price where nobody has agreed a deposit", () => {
    expect(upfrontCents(target({ depositCents: null }))).toBe(7_999_000);
  });
});

describe("the monthly swap", () => {
  it("counts a payment against what it replaces, not on top of it", () => {
    const titan = asset({ id: "titan", monthlyCost: 400 });
    const swap = monthlySwap([titan], [target({ replacesAssetId: "titan", monthlyCents: 120_000 })]);
    expect(swap.nowCents).toBe(40_000);
    expect(swap.afterCents).toBe(120_000);
    expect(swap.differenceCents).toBe(80_000);
  });

  it("keeps the cost of anything not being replaced", () => {
    const titan = asset({ id: "titan", monthlyCost: 400 });
    const mower = asset({ id: "mower", kind: "mower", monthlyCost: 50 });
    const swap = monthlySwap([titan, mower], [target({ replacesAssetId: "titan", monthlyCents: 120_000 })]);
    expect(swap.afterCents).toBe(125_000);
  });

  it("ignores something already bought, which is no longer a plan", () => {
    const titan = asset({ id: "titan", monthlyCost: 400 });
    const swap = monthlySwap(
      [titan],
      [target({ replacesAssetId: "titan", monthlyCents: 120_000, boughtOn: "2026-01-01" })]
    );
    expect(swap.afterCents).toBe(40_000);
  });
});

describe("trade-in", () => {
  it("counts what the things being replaced would fetch", () => {
    const titan = asset({ id: "titan", resaleValue: 4500 });
    const kept = asset({ id: "other", resaleValue: 900 });
    expect(tradeInCents([titan, kept], [target({ replacesAssetId: "titan" })])).toBe(450_000);
  });
});

describe("percent", () => {
  it("does not round a real chance down to nothing", () => {
    expect(percent(0.004)).toBe("under 1%");
    expect(percent(0.42)).toBe("42%");
  });
});

describe("a replacement that cannot do the job", () => {
  it("says so when the new one tows less than the old one", () => {
    // The Titan pulls 11,000. The cheaper rear-wheel-drive Cybertruck pulls
    // 7,500, and nobody would find that out until a loaded trailer was on it.
    const titan = asset({ id: "titan", towRatingLb: 11_000 });
    const short = target({ replacesAssetId: "titan", towRatingLb: 7_500 });
    const found = towShortfalls([titan], [short]);
    expect(found).toHaveLength(1);
    expect(found[0].shortLb).toBe(3_500);
  });

  it("is quiet when the new one matches, because parity is not a fault", () => {
    const titan = asset({ id: "titan", towRatingLb: 11_000 });
    expect(
      towShortfalls([titan], [target({ replacesAssetId: "titan", towRatingLb: 11_000 })])
    ).toEqual([]);
  });

  it("says nothing when either rating is unknown, rather than crying wolf", () => {
    // Guessing an unstated rating is zero would fire on every trailer in the
    // list, and a warning that fires on everything is one nobody reads.
    const titan = asset({ id: "titan", towRatingLb: null });
    expect(
      towShortfalls([titan], [target({ replacesAssetId: "titan", towRatingLb: 7_500 })])
    ).toEqual([]);
  });

  it("ignores something already bought, which is no longer a decision", () => {
    const titan = asset({ id: "titan", towRatingLb: 11_000 });
    expect(
      towShortfalls(
        [titan],
        [target({ replacesAssetId: "titan", towRatingLb: 7_500, boughtOn: "2026-01-01" })]
      )
    ).toEqual([]);
  });

  it("puts the biggest shortfall first", () => {
    const a = asset({ id: "a", towRatingLb: 11_000 });
    const b = asset({ id: "b", towRatingLb: 9_000 });
    const found = towShortfalls(
      [a, b],
      [
        target({ id: "t1", replacesAssetId: "b", towRatingLb: 7_500 }),
        target({ id: "t2", replacesAssetId: "a", towRatingLb: 7_500 }),
      ]
    );
    expect(found[0].asset.id).toBe("a");
  });
});
