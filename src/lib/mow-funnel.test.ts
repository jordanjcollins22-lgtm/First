import { describe, expect, it } from "vitest";

import { buildFunnel, percent, type FunnelOrder } from "@/lib/mow-funnel";

const t = (min: number) => new Date(Date.UTC(2026, 9, 2, 12, min)).toISOString();
const order = (o: Partial<FunnelOrder>): FunnelOrder => ({
  status: "unpaid",
  stage: "requested",
  tier: "medium",
  amountCents: 4600,
  createdAt: t(0),
  paidAt: null,
  calledAt: null,
  referralCode: "grass26",
  ...o,
});

describe("the quick mow funnel", () => {
  const funnel = buildFunnel({
    clicks: 40,
    checks: [{ inArea: true, referralCode: "grass26" }, { inArea: true, referralCode: "grass26" }, { inArea: false, referralCode: null }, { inArea: null, referralCode: null }],
    orders: [
      order({}),
      order({ tier: null, amountCents: null }),
      order({ status: "paid", stage: "to_call", paidAt: t(5), calledAt: t(6) }),
      order({ status: "paid", stage: "mowed", amountCents: 5900, paidAt: t(5), calledAt: t(20), referralCode: "abx54qb" }),
    ],
  });

  it("counts each step and the share that made it from the one before", () => {
    expect(funnel.steps.map((s) => [s.key, s.count])).toEqual([
      ["clicks", 40],
      ["checked", 4],
      ["in_area", 3],
      ["details", 4],
      ["price", 3],
      ["paid", 2],
      ["mowed", 1],
    ]);
    expect(funnel.steps[0].fromPrevious).toBeNull();
    expect(funnel.steps[1].fromPrevious).toBe(0.1);
    expect(funnel.steps[5].fromPrevious).toBeCloseTo(2 / 3);
  });

  it("counts somebody let through on a county outage as in the area", () => {
    expect(funnel.steps.find((s) => s.key === "in_area")?.count).toBe(3);
  });

  it("adds up the money paid", () => {
    expect(funnel.revenueCents).toBe(10500);
  });

  it("measures the two-minute call", () => {
    expect(funnel.calledCount).toBe(2);
    expect(funnel.calledInTimeShare).toBe(0.5);
  });

  it("splits requests and money by the link they came from", () => {
    expect(funnel.byLink).toEqual([
      { code: "abx54qb", requests: 1, paid: 1, revenueCents: 5900 },
      { code: "grass26", requests: 3, paid: 1, revenueCents: 4600 },
    ]);
  });

  it("has nothing to divide by on an empty step", () => {
    const empty = buildFunnel({ clicks: 0, checks: [], orders: [] });
    expect(empty.steps.every((s) => s.fromPrevious === null)).toBe(true);
    expect(percent(null)).toBe("—");
    expect(percent(0.456)).toBe("46%");
  });
});
