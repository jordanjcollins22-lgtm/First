import { describe, expect, it } from "vitest";

import {
  checkTipAmount,
  dollars,
  MAX_TIP_CENTS,
  stillAsking,
  tallyTips,
  tipOptions,
  type TipRecord,
} from "@/lib/tips";

describe("tipOptions", () => {
  it("offers percentages on an ordinary job", () => {
    // A $400 mow-and-tidy.
    expect(tipOptions(40_000).map((option) => option.label)).toEqual(["$40", "$60", "$80"]);
    expect(tipOptions(40_000)[1].note).toBe("15%");
  });

  it("rounds to whole dollars, because $47.83 reads like a machine wrote it", () => {
    for (const option of tipOptions(31_889)) {
      expect(option.cents % 100).toBe(0);
    }
  });

  it("stops suggesting percentages on a job too big to tip a percentage of", () => {
    // 15% of a $9,000 hardscape is $1,350, which is not a tip.
    const options = tipOptions(900_000);
    expect(options.map((option) => option.label)).toEqual(["$20", "$40", "$60"]);
    expect(options.every((option) => option.note === "")).toBe(true);
  });

  it("switches over at a job size, not gradually", () => {
    expect(tipOptions(149_900)[0].note).toBe("10%");
    expect(tipOptions(150_000)[0].note).toBe("");
  });

  it("never offers the same amount twice", () => {
    const labels = tipOptions(1_500).map((option) => option.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("still asks on a job small enough that every percentage rounds away", () => {
    const options = tipOptions(300);
    expect(options).toHaveLength(1);
    expect(options[0].cents).toBe(500);
  });

  it("falls back to flat amounts when the job total is unknown", () => {
    expect(tipOptions(0).map((option) => option.cents)).toEqual([2_000, 4_000, 6_000]);
    expect(tipOptions(-500).map((option) => option.cents)).toEqual([2_000, 4_000, 6_000]);
  });
});

describe("checkTipAmount", () => {
  it("takes a plain number", () => {
    expect(checkTipAmount("40")).toEqual({ ok: true, cents: 4_000 });
  });

  it("takes what somebody actually types", () => {
    expect(checkTipAmount("$120.50")).toEqual({ ok: true, cents: 12_050 });
    expect(checkTipAmount(" 1,000 ")).toEqual({ ok: true, cents: 100_000 });
  });

  it("catches the fat finger that turns $40 into $4,000", () => {
    const result = checkTipAmount(4_000);
    expect(result.ok).toBe(false);
  });

  it("takes exactly the ceiling", () => {
    expect(checkTipAmount(MAX_TIP_CENTS / 100)).toEqual({ ok: true, cents: MAX_TIP_CENTS });
  });

  it("turns down an amount the card fee would eat", () => {
    expect(checkTipAmount("0.50").ok).toBe(false);
  });

  it("turns down nothing, and nonsense", () => {
    expect(checkTipAmount("0").ok).toBe(false);
    expect(checkTipAmount("-20").ok).toBe(false);
    expect(checkTipAmount("thanks!").ok).toBe(false);
    expect(checkTipAmount("").ok).toBe(false);
  });
});

describe("stillAsking", () => {
  it("stops asking somebody who already paid", () => {
    expect(stillAsking({ status: "paid", amountCents: 4_000, paidAt: "2026-09-01" })).toBe(false);
  });

  it("lets somebody who said no change their mind", () => {
    expect(stillAsking({ status: "declined", amountCents: null, paidAt: null })).toBe(true);
  });

  it("keeps asking somebody who never answered", () => {
    expect(stillAsking({ status: "asked", amountCents: null, paidAt: null })).toBe(true);
    expect(stillAsking({ status: "unpaid", amountCents: 4_000, paidAt: null })).toBe(true);
  });
});

describe("tallyTips", () => {
  const tips: TipRecord[] = [
    { status: "paid", amountCents: 4_000, paidAt: "2026-08-01" },
    { status: "paid", amountCents: 6_000, paidAt: "2026-08-14" },
    { status: "declined", amountCents: null, paidAt: null },
    { status: "asked", amountCents: null, paidAt: null },
    { status: "unpaid", amountCents: 2_000, paidAt: null },
  ];

  it("counts only money that arrived", () => {
    const totals = tallyTips(tips);
    expect(totals.paid).toBe(100);
    expect(totals.count).toBe(2);
  });

  it("rates the asking on the people who answered, not the ones who ignored it", () => {
    // Two paid, one declined: two in three of those who answered.
    expect(tallyTips(tips).rate).toBe(0.67);
    expect(tallyTips(tips).pending).toBe(2);
  });

  it("says what a tip is when one is left", () => {
    expect(tallyTips(tips).average).toBe(50);
  });

  it("has nothing to report before anybody has been asked", () => {
    const nothing = tallyTips([]);
    expect(nothing.rate).toBe(0);
    expect(nothing.average).toBe(0);
    expect(nothing.paid).toBe(0);
  });

  it("does not divide by nothing when everybody ignored it", () => {
    const ignored = tallyTips([{ status: "asked", amountCents: null, paidAt: null }]);
    expect(ignored.rate).toBe(0);
    expect(ignored.pending).toBe(1);
  });
});

describe("dollars", () => {
  it("drops the cents when there are none", () => {
    expect(dollars(4_000)).toBe("$40");
  });

  it("keeps them when there are", () => {
    expect(dollars(4_050)).toBe("$40.50");
  });
});
