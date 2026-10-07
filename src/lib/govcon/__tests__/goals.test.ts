import { describe, expect, it } from "vitest";

import { contractTerms } from "../contracts";
import { analysesPerDayForGoal, observedWinRate, planForGoal, priorityScore, revenueRunRate, sizeStandardRunway } from "../goals";

describe("planForGoal", () => {
  it("works out the volume behind $4M/month at small set-aside sizes", () => {
    const p = planForGoal({ monthlyRevenueTarget: 4_000_000, avgAnnualContractValue: 75_000, winRate: 0.075, contractYears: 3 });
    expect(p.annualTarget).toBe(48_000_000);
    expect(p.activeContractsNeeded).toBe(640);
    expect(p.winsPerMonth).toBeCloseTo(17.8, 1);
    expect(p.proposalsPerMonth).toBe(238);
  });

  it("needs far fewer proposals with larger contracts", () => {
    const small = planForGoal({ monthlyRevenueTarget: 4_000_000, avgAnnualContractValue: 75_000 });
    const large = planForGoal({ monthlyRevenueTarget: 4_000_000, avgAnnualContractValue: 2_500_000 });
    expect(large.proposalsPerMonth).toBeLessThan(small.proposalsPerMonth / 20);
  });
});

describe("revenueRunRate", () => {
  it("counts only active contracts in their period", () => {
    const now = new Date("2026-10-07");
    const r = revenueRunRate(
      [
        { annualValue: 120_000, startDate: "2026-01-01", endDate: "2027-01-01", status: "active" },
        { annualValue: 600_000, startDate: "2027-01-01", endDate: "2028-01-01", status: "active" }, // not started
        { annualValue: 240_000, startDate: "2025-01-01", endDate: "2026-01-01", status: "active" }, // ended
        { annualValue: 999_000, startDate: null, endDate: null, status: "terminated" },
      ],
      now
    );
    expect(r).toBe(10_000);
  });
});

describe("observedWinRate", () => {
  it("uses the default until there are enough decisions", () => {
    expect(observedWinRate(1, 2)).toBe(0.075);
    expect(observedWinRate(3, 17)).toBe(0.15);
  });
});

describe("sizeStandardRunway", () => {
  it("shows landscaping status lost fast and facilities support lasting longer at $48M/yr", () => {
    const r = sizeStandardRunway({ annualRevenueAtTarget: 48_000_000, rampYears: 1 });
    const by = Object.fromEntries(r.map((x) => [x.naics, x.yearsUntilOtherThanSmall]));
    expect(by["561730"]).toBe(1); // 48/5 = 9.6M > 9.5M
    expect(by["561720"]).toBe(3); // 144/5 = 28.8M > 22M
    expect(by["561210"]).toBe(5); // 240/5 = 48M > 47M
  });
});

describe("priorityScore / analyses budget", () => {
  it("boosts bigger contracts and penalizes tiny ones", () => {
    expect(priorityScore(80, null)).toBe(80);
    expect(priorityScore(80, 50_000)).toBe(80);
    expect(priorityScore(80, 5_000_000)).toBe(100);
    expect(priorityScore(80, 5_000)).toBe(70);
  });
  it("sizes the daily AI budget to the proposal target, within a ceiling", () => {
    expect(analysesPerDayForGoal(25)).toBe(4);
    expect(analysesPerDayForGoal(238)).toBe(20);
    expect(analysesPerDayForGoal(2000)).toBe(40);
  });
});

describe("contractTerms", () => {
  it("annualizes base + options", () => {
    const t = contractTerms({
      totalValue: 300_000,
      subCost: 240_000,
      analysis: { periodOfPerformance: { description: "", baseMonths: 12, optionPeriods: 2, startDate: "2027-01-01" } },
    });
    expect(t.annual_value).toBe(100_000);
    expect(t.sub_annual_cost).toBe(80_000);
    expect(t.start_date).toBe("2027-01-01");
    expect(t.end_date).toBe("2030-01-01");
  });
});
