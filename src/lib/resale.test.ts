import { describe, expect, it } from "vitest";

import { RESALE_SHARE, resaleReason, resaleValue } from "@/lib/resale";

describe("resaleValue", () => {
  it("is a tenth of what it cost", () => {
    expect(resaleValue({ cost: 8200 })).toBe(820);
    expect(RESALE_SHARE).toBe(0.1);
  });

  it("rounds to the cent rather than trailing a long decimal", () => {
    expect(resaleValue({ cost: 89.99 })).toBe(9);
    expect(resaleValue({ cost: 12.34 })).toBe(1.23);
  });

  it("gives nothing back for a rental — it was never ours to sell", () => {
    expect(resaleValue({ cost: 8200, isRental: true })).toBeNull();
  });

  it("gives nothing back for a cost — there is nothing behind it", () => {
    // A permit, a delivery fee, somebody else's invoice.
    expect(resaleValue({ cost: 450, isOther: true })).toBeNull();
  });

  it("takes what somebody said over the default", () => {
    expect(resaleValue({ cost: 8200, override: 2500 })).toBe(2500);
  });

  it("accepts an override of zero, because worthless is a real answer", () => {
    expect(resaleValue({ cost: 400, override: 0 })).toBe(0);
  });

  it("ignores a nonsense override", () => {
    expect(resaleValue({ cost: 400, override: -5 })).toBe(40);
  });

  it("will not invent a value from no cost", () => {
    expect(resaleValue({ cost: null })).toBeNull();
    expect(resaleValue({ cost: 0 })).toBeNull();
  });

  it("keeps the rules in order — a rented thing with an override is still not ours", () => {
    expect(resaleValue({ cost: 8200, override: 3000, isRental: true })).toBeNull();
  });
});

describe("resaleReason", () => {
  it("says why there is no number", () => {
    expect(resaleReason({ cost: 100, isOther: true })).toBe("a cost, nothing to sell");
    expect(resaleReason({ cost: 100, isRental: true })).toBe("rented, not ours to sell");
    expect(resaleReason({ cost: null })).toBe("no cost on it yet");
  });

  it("says nothing when there is a number to show", () => {
    expect(resaleReason({ cost: 100 })).toBeNull();
  });

  it("puts the cost reason last — being a cost explains it better than a missing price", () => {
    expect(resaleReason({ cost: null, isOther: true })).toBe("a cost, nothing to sell");
  });
});
