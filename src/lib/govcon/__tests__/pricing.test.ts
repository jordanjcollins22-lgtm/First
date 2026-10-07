import { describe, expect, it } from "vitest";

import { priceBid, roundBid } from "../pricing";

describe("priceBid", () => {
  it("applies target markup when there's no history (the $15k quote → $20k bid example)", () => {
    const r = priceBid({ subQuote: 15_000, targetMarkup: 1 / 3, minMarkup: 0.12 });
    expect(r.price).toBe(20_000);
    expect(r.margin).toBe(5_000);
  });

  it("trims toward the prior award when target markup would overshoot it", () => {
    const r = priceBid({ subQuote: 80_000, targetMarkup: 0.25, minMarkup: 0.1, anchor: { annualAmount: 95_000, source: "test" } });
    expect(r.price).toBe(roundBid(95_000 * 0.97));
    expect(r.warnings).toEqual([]);
  });

  it("warns when even the minimum markup is above the prior award", () => {
    const r = priceBid({ subQuote: 100_000, targetMarkup: 0.25, minMarkup: 0.12, anchor: { annualAmount: 90_000, source: "test" } });
    expect(r.price).toBe(112_000);
    expect(r.warnings[0]).toMatch(/above the prior award/);
  });

  it("warns on quotes below the wage-determination labor floor", () => {
    const r = priceBid({ subQuote: 20_000, targetMarkup: 0.25, minMarkup: 0.12, laborFloor: 30_000 });
    expect(r.warnings[0]).toMatch(/SCA labor floor/);
  });
});
