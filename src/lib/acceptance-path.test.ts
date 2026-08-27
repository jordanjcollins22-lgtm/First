import { describe, expect, it } from "vitest";

import {
  amountForPath,
  bookableFrom,
  bookableFromKey,
  confirmationFor,
  hasDiscount,
  optionById,
  optionsAfterAccept,
} from "./acceptance-path";

const WITH_DISCOUNT = { discountCents: 25_000, totalCents: 225_000 };
const NO_DISCOUNT = { discountCents: 0, totalCents: 250_000 };

describe("optionsAfterAccept", () => {
  it("offers the trade-off only when there is a discount to trade", () => {
    expect(optionsAfterAccept(WITH_DISCOUNT).map((o) => o.id)).toEqual([
      "full",
      "plan",
      "plan_no_discount",
    ]);
  });

  it("does not offer a choice between two identical outcomes", () => {
    // With nothing to protect, "start sooner without the discount" is the
    // same as the plan, and an option that changes nothing gets a form
    // abandoned.
    expect(optionsAfterAccept(NO_DISCOUNT).map((o) => o.id)).toEqual(["full", "plan"]);
  });

  it("always lets somebody just pay", () => {
    for (const ctx of [WITH_DISCOUNT, NO_DISCOUNT]) {
      const full = optionById(ctx, "full")!;
      expect(full.keepsDiscount).toBe(true);
      expect(full.schedulesAfterFinalPayment).toBe(false);
    }
  });

  it("waits for the money only where the discount is being protected", () => {
    expect(optionById(WITH_DISCOUNT, "plan")!.schedulesAfterFinalPayment).toBe(true);
    expect(optionById(WITH_DISCOUNT, "plan_no_discount")!.schedulesAfterFinalPayment).toBe(false);
    // No discount, nothing to protect, so nothing to wait for.
    expect(optionById(NO_DISCOUNT, "plan")!.schedulesAfterFinalPayment).toBe(false);
  });

  it("keeps the discount on a plan that pays before we start", () => {
    expect(optionById(WITH_DISCOUNT, "plan")!.keepsDiscount).toBe(true);
  });

  it("gives the discount up only on the start-sooner option", () => {
    expect(optionById(WITH_DISCOUNT, "plan_no_discount")!.keepsDiscount).toBe(false);
  });

  it("explains the trade in the option itself", () => {
    const plan = optionById(WITH_DISCOUNT, "plan")!;
    expect(plan.detail.toLowerCase()).toContain("one month after your final payment");
    const sooner = optionById(WITH_DISCOUNT, "plan_no_discount")!;
    expect(sooner.detail.toLowerCase()).toContain("gives up the discount");
  });

  it("returns nothing for an id that is not on offer", () => {
    expect(optionById(NO_DISCOUNT, "plan_no_discount")).toBeUndefined();
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
    expect(amountForPath(WITH_DISCOUNT, optionById(WITH_DISCOUNT, "plan")!)).toBe(225_000);
  });

  it("puts the discount back on the bill when it is given up", () => {
    // Added back rather than recalculated: the stored total is already net of
    // it, and a percentage recomputed against a different number is a
    // different discount from the one that was agreed.
    expect(amountForPath(WITH_DISCOUNT, optionById(WITH_DISCOUNT, "plan_no_discount")!)).toBe(
      250_000
    );
  });

  it("changes nothing when there was no discount", () => {
    expect(amountForPath(NO_DISCOUNT, optionById(NO_DISCOUNT, "plan")!)).toBe(250_000);
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
  it("promises the invoice when they pay now", () => {
    expect(confirmationFor(optionById(WITH_DISCOUNT, "full")!)).toMatch(/invoice/i);
  });

  it("says the discount is safe and names the booking rule", () => {
    const text = confirmationFor(optionById(WITH_DISCOUNT, "plan")!);
    expect(text.toLowerCase()).toContain("discount is safe");
    expect(text.toLowerCase()).toContain("one month from that day");
  });

  it("says we start now on the start-sooner option", () => {
    const text = confirmationFor(optionById(WITH_DISCOUNT, "plan_no_discount")!);
    expect(text.toLowerCase()).toContain("schedule now");
  });

  it("uses no dashes", () => {
    for (const option of optionsAfterAccept(WITH_DISCOUNT)) {
      expect(confirmationFor(option)).not.toMatch(/[—–]/);
      expect(`${option.label} ${option.detail}`).not.toMatch(/[—–]/);
    }
  });
});
