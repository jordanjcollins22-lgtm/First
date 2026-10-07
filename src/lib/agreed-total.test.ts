import { describe, expect, it } from "vitest";

import { agreedTotal, agreedTotalCents } from "./agreed-total";

describe("agreedTotal", () => {
  it("takes the discount off the price", () => {
    expect(agreedTotal({ total_cost: 2350, discount_amount: 235 })).toBe(2115);
    expect(agreedTotalCents({ total_cost: "2350", discount_amount: "235" })).toBe(211500);
  });

  it("is the price when there is no discount", () => {
    expect(agreedTotal({ total_cost: 650, discount_amount: 0 })).toBe(650);
    expect(agreedTotal({ total_cost: 650 })).toBe(650);
    expect(agreedTotal({ total_cost: 650, discount_amount: null })).toBe(650);
  });

  it("is null without a total and never negative", () => {
    expect(agreedTotal(null)).toBeNull();
    expect(agreedTotal({ total_cost: null })).toBeNull();
    expect(agreedTotal({ total_cost: 100, discount_amount: 150 })).toBe(0);
  });
});
