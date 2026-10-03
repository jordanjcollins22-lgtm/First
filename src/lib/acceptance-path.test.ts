import { describe, expect, it } from "vitest";

import {
  amountForPath,
  bookableFrom,
  bookableFromKey,
  confirmationFor,
  hasDiscount,
  optionById,
  optionsAfterAccept,
  type PaymentOption,
} from "./acceptance-path";

const WITH_DISCOUNT = { discountCents: 25_000, totalCents: 225_000 };
const NO_DISCOUNT = { discountCents: 0, totalCents: 250_000 };

/**
 * The two plan paths, built by hand.
 *
 * They are no longer offered to clients, but proposals accepted on those
 * terms are out in the world and everything that reads one still has to
 * handle it. Constructed here rather than through optionsAfterAccept for
 * exactly that reason: the offer went away, the paths did not.
 */
const PLAN: PaymentOption = {
  id: "plan",
  label: "Split it into payments and keep the discount",
  detail: "We book your start date one month after your final payment.",
  keepsDiscount: true,
  schedulesAfterFinalPayment: true,
};

const PLAN_NO_DISCOUNT: PaymentOption = {
  id: "plan_no_discount",
  label: "Split it into payments and start sooner",
  detail: "This one gives up the discount.",
  keepsDiscount: false,
  schedulesAfterFinalPayment: false,
};

describe("optionsAfterAccept", () => {
  it("offers paying, and nothing else", () => {
    // Splitting was removed from the proposal page. A client choosing their
    // own instalment terms commits the business to something nobody agreed,
    // on a job that has not started. Paying over time is arranged by the
    // office against an invoice instead.
    for (const ctx of [WITH_DISCOUNT, NO_DISCOUNT]) {
      expect(optionsAfterAccept(ctx).map((o) => o.id)).toEqual(["full"]);
    }
  });

  it("keeps the discount, because there is no longer a way to give it up", () => {
    for (const ctx of [WITH_DISCOUNT, NO_DISCOUNT]) {
      const full = optionById(ctx, "full")!;
      expect(full.keepsDiscount).toBe(true);
      expect(full.schedulesAfterFinalPayment).toBe(false);
    }
  });

  it("names the ways they can actually pay, on the option they will tap", () => {
    const full = optionById(WITH_DISCOUNT, "full")!;
    expect(full.detail).toMatch(/Apple Pay/);
    expect(full.detail).toMatch(/Google Pay/);
  });

  it("no longer hands back a plan for somebody asking for one", () => {
    // The path is still understood where it is read off an accepted
    // proposal; it is simply not on offer.
    expect(optionById(WITH_DISCOUNT, "plan")).toBeUndefined();
    expect(optionById(WITH_DISCOUNT, "plan_no_discount")).toBeUndefined();
    expect(optionById(WITH_DISCOUNT, "nonsense")).toBeUndefined();
  });
});

describe("hasDiscount", () => {
  it("is only true for a real one", () => {
    expect(hasDiscount(WITH_DISCOUNT)).toBe(true);
    expect(hasDiscount(NO_DISCOUNT)).toBe(false);
    expect(hasDiscount({ discountCents: 0, totalCents: 100 })).toBe(false);
  });
});

describe("amountForPath", () => {
  it("charges the agreed total while the discount holds", () => {
    expect(amountForPath(WITH_DISCOUNT, optionById(WITH_DISCOUNT, "full")!)).toBe(225_000);
    expect(amountForPath(WITH_DISCOUNT, PLAN)).toBe(225_000);
  });

  it("puts the discount back on the bill when it is given up", () => {
    // Added back rather than recalculated: the stored total is already net of
    // it, and a percentage recomputed against a different number is a
    // different discount from the one that was agreed.
    expect(amountForPath(WITH_DISCOUNT, PLAN_NO_DISCOUNT)).toBe(250_000);
  });

  it("changes nothing when there was no discount", () => {
    expect(amountForPath(NO_DISCOUNT, PLAN)).toBe(250_000);
  });
});

describe("bookableFrom", () => {
  it("is one month after the final payment", () => {
    expect(bookableFromKey(new Date("2026-03-10T00:00:00Z"))).toBe("2026-04-10");
  });

  it("rolls the year over", () => {
    expect(bookableFromKey(new Date("2026-12-05T00:00:00Z"))).toBe("2027-01-05");
  });

  it("clamps to the end of a short month rather than sliding past it", () => {
    // A payment on the 31st of January books for the 28th of February, not
    // the 3rd of March, which is what naive month arithmetic gives.
    expect(bookableFromKey(new Date("2026-01-31T00:00:00Z"))).toBe("2026-02-28");
    expect(bookableFromKey(new Date("2028-01-31T00:00:00Z"))).toBe("2028-02-29");
  });

  it("handles the 30th into a 31-day month", () => {
    expect(bookableFromKey(new Date("2026-03-30T00:00:00Z"))).toBe("2026-04-30");
  });

  it("is always later than the payment", () => {
    for (const day of ["2026-01-01", "2026-01-31", "2026-02-28", "2026-06-15", "2026-12-31"]) {
      const paid = new Date(`${day}T00:00:00Z`);
      expect(bookableFrom(paid).getTime()).toBeGreaterThan(paid.getTime());
    }
  });
});

describe("confirmationFor", () => {
  it("sends them straight on to picking a day when they have paid", () => {
    // No promise of an invoice any more. They paid on the previous screen,
    // so the only thing left to tell them is what to do next.
    const text = confirmationFor(optionById(WITH_DISCOUNT, "full")!);
    expect(text).not.toMatch(/invoice/i);
    expect(text.toLowerCase()).toContain("pick the day");
  });

  it("says the discount is safe and names the booking rule", () => {
    const text = confirmationFor(PLAN);
    expect(text.toLowerCase()).toContain("discount is safe");
    expect(text.toLowerCase()).toContain("one month from that day");
  });

  it("sends the start-sooner option on to picking a day too", () => {
    const text = confirmationFor(PLAN_NO_DISCOUNT);
    expect(text.toLowerCase()).toContain("pick the");
  });

  it("uses no dashes", () => {
    for (const option of [...optionsAfterAccept(WITH_DISCOUNT), PLAN, PLAN_NO_DISCOUNT]) {
      expect(confirmationFor(option)).not.toMatch(/[—–]/);
      expect(`${option.label} ${option.detail}`).not.toMatch(/[—–]/);
    }
  });
});
