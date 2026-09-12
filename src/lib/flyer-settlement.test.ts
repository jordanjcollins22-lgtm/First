import { describe, expect, it } from "vitest";

import { MAX_CHECKS_PER_LOAD, needsChecking, settlementFor } from "./flyer-settlement";

describe("settlementFor", () => {
  it("settles what Stripe says is paid", () => {
    expect(settlementFor({ paymentStatus: "paid", status: "complete" })).toBe("settle");
  });

  it("settles a checkout that needed no payment", () => {
    // A hundred percent discount is still a completed sale.
    expect(settlementFor({ paymentStatus: "no_payment_required", status: "complete" })).toBe("settle");
  });

  it("waits on anything still open", () => {
    expect(settlementFor({ paymentStatus: "unpaid", status: "open" })).toBe("wait");
    expect(settlementFor({ paymentStatus: null, status: "open" })).toBe("wait");
  });

  it("marks a dead link expired rather than paid", () => {
    expect(settlementFor({ paymentStatus: "unpaid", status: "expired" })).toBe("expired");
  });

  it("never settles on a maybe", () => {
    // Marking a booking paid on a guess is how somebody ends up on a flyer
    // they never bought.
    for (const paymentStatus of [null, "", "unpaid", "processing", "pending", "failed"]) {
      expect(settlementFor({ paymentStatus, status: "complete" }), String(paymentStatus)).not.toBe(
        "settle"
      );
    }
  });
});

describe("needsChecking", () => {
  const booking = (over: Partial<{ status: string; checkoutSessionId: string | null }> = {}) => ({
    status: "approved",
    checkoutSessionId: "cs_1",
    ...over,
  });

  it("asks about a booking that opened a checkout and never came back", () => {
    expect(needsChecking([booking()])).toHaveLength(1);
  });

  it("does not ask about one already settled", () => {
    expect(needsChecking([booking({ status: "paid" })])).toEqual([]);
    expect(needsChecking([booking({ status: "placed" })])).toEqual([]);
  });

  it("does not ask about a refund", () => {
    expect(needsChecking([booking({ status: "refunded" })])).toEqual([]);
  });

  it("does not ask about somebody who never reached the card form", () => {
    expect(needsChecking([booking({ checkoutSessionId: null })])).toEqual([]);
  });

  it("caps how many we ask about at once", () => {
    // Each one is a round trip on somebody's page load.
    expect(MAX_CHECKS_PER_LOAD).toBeGreaterThan(0);
    expect(MAX_CHECKS_PER_LOAD).toBeLessThanOrEqual(20);
  });
});
