import { describe, expect, it } from "vitest";

import { netProposalCents, zeroPriceBlocker } from "./proposal-guard";

describe("zeroPriceBlocker", () => {
  it("lets a priced proposal through", () => {
    expect(zeroPriceBlocker({ total_cost: 650, discount_amount: 0 })).toBeNull();
    expect(zeroPriceBlocker({ total_cost: "2350", discount_amount: "235" })).toBeNull();
    expect(netProposalCents({ total_cost: "2350", discount_amount: "235" })).toBe(211500);
  });

  it("stops a zero, a blank and a discount that eats the price", () => {
    expect(zeroPriceBlocker({ total_cost: 0 })).toMatch(/\$0/);
    expect(zeroPriceBlocker({ total_cost: null })).toMatch(/Put the price/);
    expect(zeroPriceBlocker({ total_cost: 100, discount_amount: 100 })).toMatch(/discount/);
    expect(zeroPriceBlocker({ total_cost: -5 })).toMatch(/\$0/);
  });
});
