import { describe, expect, it } from "vitest";

import { allowedTip, tipChoices, tipFromMetadata, typedTipCents } from "@/lib/proposal-tip";

describe("tips on the pay page", () => {
  it("offers no tip, then 10, 15 and 20 percent in whole dollars", () => {
    expect(tipChoices(63200)).toEqual([
      { label: "No tip", cents: 0 },
      { label: "10%", cents: 6300 },
      { label: "15%", cents: 9500 },
      { label: "20%", cents: 12600 },
    ]);
  });

  it("never offers less than a dollar", () => {
    expect(tipChoices(300).slice(1).every((c) => c.cents >= 100)).toBe(true);
  });

  it("keeps a tip within the amount and the ceiling, and treats nonsense as no tip", () => {
    expect(allowedTip(5000, 63200)).toBe(5000);
    expect(allowedTip(99999, 63200)).toBe(63200);
    expect(allowedTip(900000, 2000000)).toBe(200000);
    expect(allowedTip(-5, 63200)).toBe(0);
    expect(allowedTip("50", 63200)).toBe(0);
    expect(allowedTip(Number.NaN, 63200)).toBe(0);
  });

  it("reads the tip back off a payment", () => {
    expect(tipFromMetadata({ tip_cents: "9500" })).toBe(9500);
    expect(tipFromMetadata({})).toBe(0);
    expect(tipFromMetadata(null)).toBe(0);
  });

  it("reads a typed amount in dollars", () => {
    expect(typedTipCents("$25")).toBe(2500);
    expect(typedTipCents("12.50")).toBe(1250);
    expect(typedTipCents("")).toBe(0);
    expect(typedTipCents("abc")).toBeNull();
  });
});
