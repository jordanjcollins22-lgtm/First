import { describe, expect, it } from "vitest";

import {
  forecastCommission,
  monthsBetween,
  quotedShape,
  type CommissionSale,
} from "@/lib/commission-forecast";

function sale(
  jobId: string,
  collected: number,
  completedAt: string | null,
  pct = 15,
  paidOut = 0
): CommissionSale {
  return {
    jobId,
    collected,
    earnedTotal: Math.round(collected * (pct / 100) * 100) / 100,
    paidOut,
    completedAt,
    pct,
  };
}

describe("monthsBetween", () => {
  it("measures the span rather than counting calendar months", () => {
    // Six weeks touching three calendar months is a month and a half of work.
    expect(monthsBetween(["2026-03-28", "2026-04-15", "2026-05-08"])).toBeCloseTo(1.35, 1);
  });

  it("will not call two jobs a week apart a rate", () => {
    // Otherwise two jobs seven days apart reads as eight sales a month.
    expect(monthsBetween(["2026-07-01", "2026-07-08"])).toBe(1);
  });

  it("has nothing to measure with no jobs", () => {
    expect(monthsBetween([])).toBe(0);
  });
});

describe("forecastCommission", () => {
  const book: CommissionSale[] = [
    sale("a", 1_200, "2026-04-10"),
    sale("b", 3_400, "2026-05-02"),
    sale("c", 800, "2026-05-20"),
    sale("d", 2_600, "2026-06-15"),
    sale("e", 14_000, "2026-07-01"),
    sale("f", 0, "2026-07-20"),
    sale("g", 900, null),
  ];

  it("averages only the sales that actually paid", () => {
    // The finished job with nothing collected is a real hole and a real job.
    // Averaging it in as a zero would say the sales are smaller than they are.
    const forecast = forecastCommission(book);
    expect(forecast.sales.jobs).toBe(5);
    expect(forecast.sales.collected).toBe(22_000);
    expect(forecast.sales.averageSale).toBe(4_400);
  });

  it("puts the middle sale beside the average, because one job moved it", () => {
    const forecast = forecastCommission(book);
    // $14,000 dragged the mean to $4,400. Half the jobs were under $2,600.
    expect(forecast.sales.medianSale).toBe(2_600);
    expect(forecast.sales.medianSale).toBeLessThan(forecast.sales.averageSale);
  });

  it("counts the job that never paid in the rate of work", () => {
    const forecast = forecastCommission(book);
    // Six finished jobs, not five: the crew still went out.
    expect(forecast.sales.jobsPerMonth).toBeGreaterThan(0);
    expect(forecast.sales.months).toBeCloseTo(3.3, 1);
  });

  it("dates a month by when the job finished, not when it paid", () => {
    const forecast = forecastCommission(book);
    expect(forecast.months.map((row) => row.month)).toEqual([
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
    ]);
    // May was two jobs: $3,400 and $800.
    expect(forecast.months[1]).toMatchObject({ jobs: 2, collected: 4_200, commission: 630 });
  });

  it("takes the middle month as typical, so one big month is not the plan", () => {
    const forecast = forecastCommission(book);
    // Months run 180, 630, 390, 2100. The mean says over a thousand; the
    // middle says about five hundred, which is what a normal month costs.
    expect(forecast.typicalMonthly).toBe(510);
    expect(forecast.averageMonthly).toBeGreaterThan(forecast.typicalMonthly);
  });

  it("says what the rate actually works out at across the book", () => {
    const forecast = forecastCommission(book);
    expect(forecast.blendedPct).toBe(15);
  });

  it("blends the rate when people are on different ones", () => {
    const mixed = [sale("a", 1_000, "2026-05-01", 10), sale("b", 1_000, "2026-06-01", 20)];
    expect(forecastCommission(mixed).blendedPct).toBe(15);
  });

  it("says what one more average sale costs", () => {
    const forecast = forecastCommission(book);
    expect(forecast.perAverageSale).toBe(660);
  });

  it("keeps what is owed apart from what is still building up", () => {
    const forecast = forecastCommission(book);
    // The unfinished job's $135 is coming, not owed.
    expect(forecast.accruing).toBe(135);
    expect(forecast.outstanding).toBe(3_300);
  });

  it("takes what has already been handed over off what is owed", () => {
    const partPaid = [sale("a", 2_000, "2026-05-01", 15, 200)];
    expect(forecastCommission(partPaid).outstanding).toBe(100);
  });

  it("never reports a negative debt when somebody was overpaid", () => {
    const overpaid = [sale("a", 1_000, "2026-05-01", 15, 500)];
    expect(forecastCommission(overpaid).outstanding).toBe(0);
  });

  it("has nothing to say about an empty book", () => {
    const forecast = forecastCommission([]);
    expect(forecast.sales.averageSale).toBe(0);
    expect(forecast.typicalMonthly).toBe(0);
    expect(forecast.blendedPct).toBe(0);
    expect(forecast.months).toEqual([]);
  });

  it("does not divide by nothing when no job has finished", () => {
    const forecast = forecastCommission([sale("g", 900, null)]);
    expect(Number.isFinite(forecast.averageMonthly)).toBe(true);
    expect(forecast.sales.jobsPerMonth).toBe(0);
  });
});

describe("quotedShape", () => {
  const quotes = [1_200, 3_400, 800, 2_600, 14_000];

  it("says what a job is quoted at", () => {
    const shape = quotedShape(quotes, 15);
    expect(shape.proposals).toBe(5);
    expect(shape.averageQuote).toBe(4_400);
    expect(shape.medianQuote).toBe(2_600);
  });

  it("prices the commission on a whole quote, which is the ceiling", () => {
    // What it would cost if every dollar quoted came in. It never all does.
    expect(quotedShape(quotes, 15).commissionPerQuote).toBe(660);
  });

  it("ignores proposals with no number on them", () => {
    expect(quotedShape([0, -100, 2_000, Number.NaN], 15).proposals).toBe(1);
  });

  it("has nothing to say with no proposals", () => {
    const shape = quotedShape([], 15);
    expect(shape.averageQuote).toBe(0);
    expect(shape.commissionPerQuote).toBe(0);
  });
});
