import { describe, expect, it } from "vitest";

import { advanceLimit, advanceRoom, isPending, paidInFull, splitRepayment, whyNotAdvance } from "./commission-advance";

describe("an advance on commission", () => {
  it("can be up to what the project's commission will come to, less what has gone out or been asked for", () => {
    // 15% of a $2,000 job is $300; $50 already paid, $100 asked for.
    expect(advanceRoom({ pct: 15, contractValue: 2000, collected: 0, paidOut: 50 }, 100)).toBe(150);
    // Collected more than the contract said: the rate on what came in.
    expect(advanceRoom({ pct: 10, contractValue: 1000, collected: 1200, paidOut: 0 }, 0)).toBe(120);
    expect(advanceRoom({ pct: 15, contractValue: 1000, collected: 0, paidOut: 200 }, 0)).toBe(0);
  });

  it("is only on a project the client has paid in full", () => {
    expect(paidInFull(2000, 2000)).toBe(true);
    expect(paidInFull(2000, 2100)).toBe(true);
    expect(paidInFull(2000, 1000)).toBe(false);
    expect(paidInFull(null, 500)).toBe(false);
    expect(paidInFull(0, 0)).toBe(false);
  });

  it("says why an amount can't be asked for", () => {
    expect(whyNotAdvance(0, 100)).toMatch(/how much/);
    expect(whyNotAdvance(50, 0)).toMatch(/nothing to advance/);
    expect(whyNotAdvance(150, 100)).toBe("The most you can ask for right now is $100.");
    expect(whyNotAdvance(100, 100)).toBeNull();
  });

  it("holds its share only while it is waiting or approved", () => {
    expect(isPending("requested")).toBe(true);
    expect(isPending("approved")).toBe(true);
    expect(isPending("paid")).toBe(false);
    expect(isPending("declined")).toBe(false);
  });

  it("can be up to the commission to come, less what is owed and asked for", () => {
    expect(advanceLimit([607.5, 487.5, 97.5, 47.25], 500, 0)).toBe(739.75);
    expect(advanceLimit([100], 150, 0)).toBe(0);
  });

  it("is paid back first out of every commission payout, then the rest is handed over", () => {
    const split = splitRepayment([{ amount: 300 }, { amount: 300 }, { amount: 100 }], 500);
    expect(split.map((l) => [l.repay, l.cash])).toEqual([[300, 0], [200, 100], [0, 100]]);
    expect(splitRepayment([{ amount: 80 }], 0)[0]).toMatchObject({ repay: 0, cash: 80 });
  });
});
