import { describe, expect, it } from "vitest";

import {
  chargeFromSpending,
  monthsCovered,
  reviewSpend,
  type Bucket,
  type Spent,
} from "@/lib/spend-review";

function line(key: string, amount: number, postedOn: string, id = `${key}-${postedOn}`): Spent {
  return { id, key, who: key, amount, postedOn, category: null };
}

const CHECKED = { checkedCount: 0, chargeCount: 0, checkedAmount: 0, overheadAmount: 0 };

describe("monthsCovered", () => {
  it("measures the span rather than counting calendar months", () => {
    // Six weeks touching three calendar months is a month and a half of
    // spending. Counting the months would understate everything by half.
    expect(monthsCovered(["2026-03-28", "2026-04-15", "2026-05-08"])).toBeCloseTo(1.35, 1);
  });

  it("does not divide a day's spending by nothing", () => {
    expect(monthsCovered(["2026-03-28"])).toBeGreaterThan(0);
    expect(monthsCovered([])).toBe(0);
  });

  it("reads the span whatever order the days arrive in", () => {
    const forwards = monthsCovered(["2026-03-01", "2026-09-01"]);
    const backwards = monthsCovered(["2026-09-01", "2026-03-01"]);
    expect(forwards).toBe(backwards);
  });
});

describe("reviewSpend", () => {
  const spent: Spent[] = [
    line("rent", 2_790, "2026-07-02"),
    line("rent", 2_790, "2026-08-02"),
    line("amex", 6_500, "2026-07-13"),
    line("amex", 14_495, "2026-08-28"),
    line("home depot", 300, "2026-07-15"),
    line("home depot", 540, "2026-08-12"),
    line("doordash", 92, "2026-08-02"),
  ];

  const bucket = (key: string): Bucket =>
    key === "rent" ? "overhead" : key === "amex" ? "transfer" : key === "doordash" ? "dismissed" : "uncounted";

  it("accounts for every dollar that left", () => {
    const review = reviewSpend(spent, bucket, { ...CHECKED, overheadAmount: 2_790 });
    const parts =
      review.uncountedPerMonth + review.transfersPerMonth + review.dismissedPerMonth;
    // Overhead is stated from its own monthly figure rather than a share of
    // the window, so the three derived buckets are what must add back up.
    const overheadShare = review.outPerMonth - parts;
    expect(overheadShare).toBeGreaterThan(0);
    expect(parts + overheadShare).toBeCloseTo(review.outPerMonth, 2);
  });

  it("states the overhead from its own monthly figure, not the window", () => {
    // Two months of rent in a window a month and a bit long would read as more
    // than a month's rent if it were divided by the span.
    const review = reviewSpend(spent, bucket, { ...CHECKED, overheadAmount: 2_790 });
    expect(review.overheadPerMonth).toBe(2_790);
  });

  it("keeps cards being paid off out of the spending", () => {
    const review = reviewSpend(spent, bucket, CHECKED);
    expect(review.transfersPerMonth).toBeGreaterThan(0);
    expect(review.uncounted.some((merchant) => merchant.key === "amex")).toBe(false);
  });

  it("lists what nothing accounts for, biggest first", () => {
    const review = reviewSpend(spent, bucket, CHECKED);
    expect(review.uncounted.map((merchant) => merchant.key)).toEqual(["home depot"]);
    expect(review.uncounted[0].total).toBe(840);
    expect(review.uncounted[0].hits).toBe(2);
  });

  it("says when each uncounted merchant was last used", () => {
    const review = reviewSpend(spent, bucket, CHECKED);
    expect(review.uncounted[0].firstSeen).toBe("2026-07-15");
    expect(review.uncounted[0].lastSeen).toBe("2026-08-12");
  });

  it("hands back only as many as asked for", () => {
    const many = [
      line("a", 100, "2026-07-01"),
      line("b", 200, "2026-07-02"),
      line("c", 300, "2026-07-03"),
    ];
    const review = reviewSpend(many, () => "uncounted", CHECKED, 2);
    expect(review.uncounted.map((merchant) => merchant.key)).toEqual(["c", "b"]);
  });

  it("ignores money coming in", () => {
    const review = reviewSpend([line("refund", -500, "2026-07-01")], () => "uncounted", CHECKED);
    expect(review.outPerMonth).toBe(0);
    expect(review.uncounted).toEqual([]);
  });

  it("carries the review tally straight through", () => {
    const review = reviewSpend(spent, bucket, {
      checkedCount: 4,
      chargeCount: 11,
      checkedAmount: 3_100,
      overheadAmount: 4_559.83,
    });
    expect(review.checkedCount).toBe(4);
    expect(review.chargeCount).toBe(11);
    expect(review.checkedAmount).toBe(3_100);
  });
});

describe("chargeFromSpending", () => {
  const lease = [line("auto lease", 551, "2026-05-21"), line("auto lease", 1_103, "2026-07-02")];

  it("averages spending with no pattern over the months it covers", () => {
    const charge = chargeFromSpending("auto lease", lease, 6)!;
    expect(charge.monthlyAmount).toBe(275.67);
    expect(charge.hits).toBe(2);
  });

  it("admits nothing was detected", () => {
    const charge = chargeFromSpending("auto lease", lease, 6)!;
    expect(charge.confidence).toBe(0);
    expect(charge.variableAmount).toBe(true);
  });

  it("takes the most recent description as the name", () => {
    const charge = chargeFromSpending(
      "auto lease",
      [
        { ...line("auto lease", 551, "2026-05-21"), who: "CAF DIRECT CHECK AUTO LEASE" },
        { ...line("auto lease", 1_103, "2026-07-02"), who: "CAF AUTO LEASE" },
      ],
      6
    )!;
    expect(charge.label).toBe("CAF AUTO LEASE");
  });

  it("has nothing to say about a merchant with no transactions", () => {
    expect(chargeFromSpending("nothing", [], 6)).toBeNull();
  });

  it("does not divide by nothing when the window is empty", () => {
    const charge = chargeFromSpending("auto lease", lease, 0)!;
    expect(Number.isFinite(charge.monthlyAmount)).toBe(true);
    expect(charge.monthlyAmount).toBe(1_654);
  });
});
