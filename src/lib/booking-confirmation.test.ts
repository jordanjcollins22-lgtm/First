import { describe, expect, it } from "vitest";

import { confirmationFor, showsConfirmation, type ConfirmationInput } from "./booking-confirmation";

function input(overrides: Partial<ConfirmationInput> = {}): ConfirmationInput {
  return {
    status: "accepted",
    paymentPath: "full",
    paidAt: "2026-08-29T12:00:00Z",
    schedulesAfterFinalPayment: false,
    canCharge: true,
    ...overrides,
  };
}

describe("confirmationFor", () => {
  it("confirms a paid proposal and says somebody is picking it up", () => {
    const c = confirmationFor(input());
    expect(c.kind).toBe("processed");
    expect(c.redirectTo).toBeNull();
    expect(c.body).toMatch(/team member will reach out/i);
    expect(c.heading).toMatch(/processed/i);
  });

  it("sends somebody who backed out of the card sheet back to it", () => {
    // The glitch: the payment path is claimed when they pick how to pay, so
    // closing the wallet without paying used to land on a bookable page.
    const c = confirmationFor(input({ paidAt: null }));
    expect(c.kind).toBe("unpaid");
    expect(c.redirectTo).toBe("pay");
  });

  it("never confirms a booking for a proposal nobody paid for", () => {
    for (const paymentPath of ["full", "plan", "plan_no_discount", null]) {
      const c = confirmationFor(input({ paidAt: null, paymentPath }));
      expect(showsConfirmation(c)).toBe(false);
    }
  });

  it("sends an unaccepted proposal back to the proposal", () => {
    for (const status of ["needs_approval", "sent", "declined"]) {
      const c = confirmationFor(input({ status }));
      expect(c.kind).toBe("not_accepted");
      expect(c.redirectTo).toBe("proposal");
    }
  });

  it("says the discount is safe when the plan books after the payoff", () => {
    const c = confirmationFor(input({ schedulesAfterFinalPayment: true }));
    expect(c.kind).toBe("after_payoff");
    expect(c.body).toMatch(/discount is safe/i);
    expect(c.body).toMatch(/final payment/i);
  });

  it("confirms an invoiced job, since there was no card sheet to abandon", () => {
    const c = confirmationFor(input({ paidAt: null, canCharge: false }));
    expect(c.kind).toBe("invoiced");
    expect(c.redirectTo).toBeNull();
    expect(c.body).toMatch(/team member will reach out/i);
  });

  it("still needs a choice before invoicing", () => {
    const c = confirmationFor(input({ paidAt: null, canCharge: false, paymentPath: null }));
    expect(c.redirectTo).toBe("pay");
  });

  it("cannot send a client round in a loop between paying and confirming", () => {
    // The pay screen forwards to the confirmation exactly when this says
    // there is one, and the confirmation sends them back when there is not.
    // Both call this, so the only way to loop is for the plan to change the
    // answer — which it must not, since the pay screen does not know it yet.
    for (const status of ["accepted", "sent"]) {
      for (const paymentPath of ["full", "plan", null]) {
        for (const paidAt of ["2026-08-29T12:00:00Z", null]) {
          for (const canCharge of [true, false]) {
            const base = { status, paymentPath, paidAt, canCharge };
            expect(confirmationFor({ ...base, schedulesAfterFinalPayment: true }).redirectTo).toBe(
              confirmationFor({ ...base, schedulesAfterFinalPayment: false }).redirectTo
            );
          }
        }
      }
    }
  });

  it("never offers the client a day to pick", () => {
    for (const overrides of [{}, { schedulesAfterFinalPayment: true }, { paidAt: null, canCharge: false }]) {
      const c = confirmationFor(input(overrides));
      expect(c.body).not.toMatch(/pick a day|choose a day|which day/i);
    }
  });
});
