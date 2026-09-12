import { describe, expect, it } from "vitest";

import {
  outstandingCents,
  owedFirst,
  paymentLabel,
  paymentState,
  SETTLED_TOLERANCE_CENTS,
} from "@/lib/proposal-payment";

describe("whether the money has arrived", () => {
  it("is nothing in when nothing is in", () => {
    expect(paymentState({ totalCents: 350_00, collectedCents: 0 })).toBe("unpaid");
  });

  it("is part paid on a deposit", () => {
    // Worth its own answer: a deposit taken is a different conversation from
    // a client who has paid nothing at all.
    expect(paymentState({ totalCents: 350_00, collectedCents: 100_00 })).toBe("part");
  });

  it("is paid once the whole thing is in", () => {
    expect(paymentState({ totalCents: 350_00, collectedCents: 350_00 })).toBe("paid");
  });

  it("believes our own settlement over the arithmetic", () => {
    // The payment flow sets this itself, and the payments it records have not
    // all been attributed back to a job — so a job can be genuinely paid while
    // the sum knows nothing about it.
    expect(
      paymentState({ totalCents: 350_00, collectedCents: 0, settledAt: "2026-09-02T00:15:26Z" })
    ).toBe("paid");
  });

  it("does not chase a client over a few cents", () => {
    const facts = { totalCents: 350_00, collectedCents: 350_00 - SETTLED_TOLERANCE_CENTS };
    expect(paymentState(facts)).toBe("paid");
  });

  it("still chases a client over a real shortfall", () => {
    expect(paymentState({ totalCents: 350_00, collectedCents: 340_00 })).toBe("part");
  });

  it("counts an overpayment as paid rather than as something odd", () => {
    expect(paymentState({ totalCents: 350_00, collectedCents: 400_00 })).toBe("paid");
  });

  it("calls money against no agreed total paid, not part paid", () => {
    // "Part paid" would claim we know what is still owed. We do not.
    expect(paymentState({ totalCents: null, collectedCents: 100_00 })).toBe("paid");
    expect(paymentState({ totalCents: 0, collectedCents: 100_00 })).toBe("paid");
  });

  it("calls no money against no total unpaid", () => {
    expect(paymentState({ totalCents: null, collectedCents: 0 })).toBe("unpaid");
  });

  it("ignores a negative amount rather than reading it as a refund", () => {
    expect(paymentState({ totalCents: 350_00, collectedCents: -50_00 })).toBe("unpaid");
  });
});

describe("what is still owed", () => {
  it("is the difference while money is outstanding", () => {
    expect(outstandingCents({ totalCents: 350_00, collectedCents: 100_00 })).toBe(250_00);
  });

  it("is nothing once it is paid", () => {
    expect(outstandingCents({ totalCents: 350_00, collectedCents: 350_00 })).toBe(0);
    expect(outstandingCents({ totalCents: 350_00, collectedCents: 0, settledAt: "x" })).toBe(0);
  });

  it("is never negative, because an overpayment is not a debt", () => {
    expect(outstandingCents({ totalCents: 350_00, collectedCents: 900_00 })).toBe(0);
  });

  it("is the whole total when nothing has come in", () => {
    expect(outstandingCents({ totalCents: 350_00, collectedCents: 0 })).toBe(350_00);
  });
});

describe("the money line on a row", () => {
  it("says nothing at all when nothing has come in", () => {
    // A row that says "$0 in" is a row of noise on every unpaid proposal.
    expect(paymentLabel({ totalCents: 350_00, collectedCents: 0 })).toBeNull();
  });

  it("says what is in and what is left when part paid", () => {
    const label = paymentLabel({ totalCents: 350_00, collectedCents: 100_00 });
    expect(label).toContain("$100");
    expect(label).toContain("$250");
  });

  it("says the amount when it is paid", () => {
    expect(paymentLabel({ totalCents: 350_00, collectedCents: 350_00 })).toBe("Paid $350");
  });

  it("just says paid when settled with no amount tied to the job", () => {
    expect(paymentLabel({ totalCents: 350_00, collectedCents: 0, settledAt: "x" })).toBe("Paid");
  });
});

describe("ordering a board by what is owed", () => {
  it("puts the biggest debt first, because that is the call to make", () => {
    const big = { totalCents: 5_000_00, collectedCents: 0 };
    const small = { totalCents: 300_00, collectedCents: 0 };
    expect([small, big].sort(owedFirst)[0]).toBe(big);
  });

  it("puts the settled ones last", () => {
    const owing = { totalCents: 300_00, collectedCents: 0 };
    const settled = { totalCents: 5_000_00, collectedCents: 5_000_00 };
    expect([settled, owing].sort(owedFirst)[0]).toBe(owing);
  });
});
