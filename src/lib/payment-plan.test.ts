import { describe, expect, it } from "vitest";

import {
  buildSchedule,
  checkPlan,
  describePlan,
  fromCents,
  isSettled,
  outstandingCents,
  scheduleTotal,
  toCents,
  type PlanInput,
} from "@/lib/payment-plan";

function plan(over: Partial<PlanInput> = {}): PlanInput {
  return { totalCents: 120_000, kind: "instalments", instalments: 3, interval: "monthly", ...over };
}

describe("money in cents", () => {
  it("rounds to the penny rather than carrying a float", () => {
    expect(toCents(1234.56)).toBe(123456);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(fromCents(123456)).toBe(1234.56);
  });
});

describe("a plan that makes sense", () => {
  it("accepts an ordinary one", () => {
    expect(checkPlan(plan()).ok).toBe(true);
  });

  it("refuses a total of nothing", () => {
    expect(checkPlan(plan({ totalCents: 0 })).ok).toBe(false);
    expect(checkPlan(plan({ totalCents: -100 })).ok).toBe(false);
  });

  it("refuses a deposit larger than the job", () => {
    expect(checkPlan(plan({ depositCents: 200_000 })).ok).toBe(false);
  });

  it("refuses a deposit that covers the whole thing as a plan", () => {
    // That is a one-off wearing a plan's clothes.
    const verdict = checkPlan(plan({ depositCents: 120_000 }));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("one-off");
  });

  it("refuses instalments with no count or no interval", () => {
    expect(checkPlan(plan({ instalments: 0 })).ok).toBe(false);
    expect(checkPlan(plan({ interval: undefined })).ok).toBe(false);
  });

  it("refuses a number of payments nobody wants to chase", () => {
    expect(checkPlan(plan({ instalments: 61 })).ok).toBe(false);
  });

  it("refuses a deposit on a subscription", () => {
    // A subscription bills the same amount each time; a deposit makes the
    // first one different, which is a different product.
    expect(checkPlan(plan({ kind: "subscription", depositCents: 5_000 })).ok).toBe(false);
  });
});

describe("splitting the total", () => {
  it("adds up to exactly the total", () => {
    const schedule = buildSchedule(plan());
    expect(scheduleTotal(schedule)).toBe(120_000);
  });

  it("loses nothing to rounding on an awkward total", () => {
    // 1234.56 split three ways is where the penny goes missing.
    for (const total of [123_456, 100_001, 99_999, 1, 7, 33_333]) {
      for (const count of [2, 3, 4, 6, 7, 12]) {
        const schedule = buildSchedule(plan({ totalCents: total, instalments: count }));
        expect(scheduleTotal(schedule)).toBe(total);
      }
    }
  });

  it("loses nothing when there is a deposit as well", () => {
    for (const deposit of [1, 5_000, 33_333]) {
      const schedule = buildSchedule(plan({ totalCents: 123_456, depositCents: deposit, instalments: 5 }));
      expect(scheduleTotal(schedule)).toBe(123_456);
    }
  });

  it("puts the odd penny on the earliest payments", () => {
    const schedule = buildSchedule(plan({ totalCents: 100_001, instalments: 3 }));
    const amounts = schedule.map((i) => i.amountCents);
    expect(amounts[0]).toBeGreaterThanOrEqual(amounts[amounts.length - 1]);
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(100_001);
  });

  it("takes the deposit today and the first instalment an interval later", () => {
    const schedule = buildSchedule(plan({ depositCents: 30_000 }));
    expect(schedule[0]).toMatchObject({ isDeposit: true, dueInDays: 0 });
    expect(schedule[1].dueInDays).toBe(30);
    expect(schedule[2].dueInDays).toBe(60);
  });

  it("numbers them the way somebody counts", () => {
    const schedule = buildSchedule(plan({ depositCents: 30_000 }));
    expect(schedule.map((i) => i.number)).toEqual([1, 2, 3, 4]);
  });

  it("makes a one-off a single payment", () => {
    const schedule = buildSchedule(plan({ kind: "one_time" }));
    expect(schedule).toHaveLength(1);
    expect(schedule[0].amountCents).toBe(120_000);
  });

  it("makes a one-off with a deposit two payments", () => {
    const schedule = buildSchedule(plan({ kind: "one_time", depositCents: 30_000 }));
    expect(schedule.map((i) => i.amountCents)).toEqual([30_000, 90_000]);
  });

  it("makes a subscription one recurring amount, not a list with an end", () => {
    const schedule = buildSchedule(plan({ kind: "subscription", instalments: undefined }));
    expect(schedule).toHaveLength(1);
    expect(schedule[0].amountCents).toBe(120_000);
  });

  it("gives nothing back for a plan that does not check out", () => {
    expect(buildSchedule(plan({ totalCents: 0 }))).toEqual([]);
  });
});

describe("how it reads to the customer", () => {
  it("describes a plain instalment plan", () => {
    expect(describePlan(plan())).toBe("3 payments of $400.00, monthly.");
  });

  it("mentions the deposit first, because that is what they pay today", () => {
    expect(describePlan(plan({ depositCents: 30_000 }))).toContain("$300.00 down");
  });

  it("says both amounts when the payments are not identical", () => {
    expect(describePlan(plan({ totalCents: 100_001 }))).toContain("then");
  });

  it("describes a one-off and a subscription", () => {
    expect(describePlan(plan({ kind: "one_time" }))).toBe("$1,200.00 in full.");
    expect(describePlan(plan({ kind: "subscription", interval: "monthly" }))).toContain("until it is cancelled");
  });

  it("says what is wrong rather than describing a plan that is not valid", () => {
    expect(describePlan(plan({ totalCents: 0 }))).toContain("more than nothing");
  });
});

describe("what is still owed", () => {
  it("subtracts what has been paid", () => {
    expect(outstandingCents(120_000, [{ amountCents: 40_000 }])).toBe(80_000);
  });

  it("treats an overpayment as settled, not as a negative debt", () => {
    expect(outstandingCents(120_000, [{ amountCents: 130_000 }])).toBe(0);
    expect(isSettled(120_000, [{ amountCents: 130_000 }])).toBe(true);
  });

  it("is not settled while a penny is outstanding", () => {
    expect(isSettled(120_000, [{ amountCents: 119_999 }])).toBe(false);
  });
});
