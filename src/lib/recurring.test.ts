import { describe, expect, it } from "vitest";

import {
  detectRecurring,
  isLive,
  looksLikeTransfer,
  merchantKey,
  monthlyEquivalent,
  tidyLabel,
  monthlyTotals,
  nextDueOn,
  type Txn,
} from "@/lib/recurring";

const TODAY = new Date("2026-09-11T12:00:00Z");

/** A run of charges, one per month, on the same day. */
function monthly(
  who: string,
  amount: number | number[],
  months: string[],
  category: string | null = null
): Txn[] {
  return months.map((month, i) => ({
    id: `${who}-${i}`,
    who,
    amount: Array.isArray(amount) ? amount[i] : amount,
    postedOn: month,
    accountId: "acct",
    category,
  }));
}

describe("merchant names the bank mangled", () => {
  it("strips reference numbers so one subscription is one subscription", () => {
    expect(merchantKey("VERIZON PAYMENTREC 2579922000001")).toBe(merchantKey("VERIZON"));
  });

  it("folds case and punctuation", () => {
    expect(merchantKey("Amazon Prime*")).toBe(merchantKey("AMAZON PRIME"));
  });

  it("keeps two different merchants apart", () => {
    expect(merchantKey("Spotify")).not.toBe(merchantKey("Comcast"));
  });

  it("gives something back for a name made only of digits", () => {
    expect(merchantKey("48472830")).toBe("unknown");
  });
});

describe("money moving inside the business", () => {
  it("knows a card payment when it sees one", () => {
    expect(looksLikeTransfer("DISCOVER E-PAYMENT 2747")).toBe(true);
    expect(looksLikeTransfer("APPLECARD GSBANK PAYMENT 119711663")).toBe(true);
    expect(looksLikeTransfer("Zelle Gianna Burgess")).toBe(true);
  });

  it("does not mistake a shop for one", () => {
    expect(looksLikeTransfer("Home Depot")).toBe(false);
  });
});

describe("finding what comes back", () => {
  const MONTHS = ["2026-04-23", "2026-05-23", "2026-06-23", "2026-07-23", "2026-08-23"];

  it("calls an identical monthly charge a subscription", () => {
    const [found] = detectRecurring(monthly("Amazon Prime", 15.89, MONTHS), TODAY);
    expect(found.kind).toBe("subscription");
    expect(found.cadence).toBe("monthly");
    expect(found.typicalAmount).toBe(15.89);
    expect(found.dayOfMonth).toBe(23);
  });

  it("calls a bill that moves an obligation, not a subscription", () => {
    // Insurance and utilities recur and are not optional, but the amount
    // wanders. Different question, different list.
    const [found] = detectRecurring(
      monthly("State Farm", [210, 250, 305, 232, 256], MONTHS),
      TODAY
    );
    expect(found.kind).toBe("obligation");
  });

  it("leaves a restaurant out, however regular the visits", () => {
    // The mistake that makes the whole list look wrong. A bistro every other
    // Friday has a rhythm and a rough price and is not a bill.
    const found = detectRecurring(
      monthly("Pairings Bistro", [42, 51, 46, 39, 55], MONTHS, "FOOD_AND_DRINK"),
      TODAY
    );
    expect(found).toEqual([]);
  });

  it("still allows a real subscription billed through a shop category", () => {
    // Identical to the penny every month is a machine, whatever the bank
    // filed it under.
    const found = detectRecurring(
      monthly("HP Instant Ink", 8.47, MONTHS, "GENERAL_MERCHANDISE"),
      TODAY
    );
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe("subscription");
  });

  it("takes the bank's word that something is a transfer", () => {
    const [found] = detectRecurring(
      monthly("JPMorgan Chase Ext Trnsfr 30230997829", 551.43, MONTHS, "TRANSFER_OUT"),
      TODAY
    );
    expect(found.kind).toBe("transfer");
  });

  it("leaves a shop somebody visits often out of it", () => {
    // The mistake that makes the whole list look wrong. Walmart eleven times
    // at wildly different amounts is a habit, not a subscription.
    const found = detectRecurring(
      monthly("Walmart", [12, 340, 58, 700, 26], MONTHS),
      TODAY
    );
    expect(found).toEqual([]);
  });

  it("takes two charges when they are identical to the penny", () => {
    // A machine billing us, not a person spending.
    const found = detectRecurring(monthly("Bolt", 25, ["2026-07-10", "2026-08-10"]), TODAY);
    expect(found).toHaveLength(1);
  });

  it("wants more than two when the amount moves at all", () => {
    const found = detectRecurring(monthly("Someone", [100, 118], ["2026-07-10", "2026-08-10"]), TODAY);
    expect(found).toEqual([]);
  });

  it("ignores money coming in", () => {
    const paid: Txn[] = monthly("A Client", 500, MONTHS).map((t) => ({ ...t, amount: -t.amount }));
    expect(detectRecurring(paid, TODAY)).toEqual([]);
  });

  it("finds a weekly rhythm as weekly", () => {
    const [found] = detectRecurring(
      monthly("Fuel card", 80, ["2026-08-07", "2026-08-14", "2026-08-21", "2026-08-28"]),
      TODAY
    );
    expect(found.cadence).toBe("weekly");
  });

  it("finds a yearly renewal and still prices it per month", () => {
    const [found] = detectRecurring(
      monthly("Domain", 120, ["2024-09-01", "2025-09-01", "2026-09-01"]),
      TODAY
    );
    expect(found.cadence).toBe("yearly");
    expect(found.monthlyAmount).toBe(10);
  });

  it("puts the biggest monthly cost first, because that is the money", () => {
    const found = detectRecurring(
      [...monthly("Small", 5, MONTHS), ...monthly("Big", 300, MONTHS)],
      TODAY
    );
    expect(found[0].label).toBe("Big");
  });

  it("marks a card payment as a transfer rather than an overhead", () => {
    const [found] = detectRecurring(monthly("DISCOVER E-PAYMENT 2747", 480, MONTHS), TODAY);
    expect(found.kind).toBe("transfer");
  });

  it("groups the same merchant under its different bank spellings", () => {
    const found = detectRecurring(
      [
        ...monthly("VERIZON PAYMENTREC 2579922000001", 84.84, MONTHS.slice(0, 3)),
        ...monthly("VERIZON PAYMENTREC 9911002000004", 84.84, MONTHS.slice(3)),
      ],
      TODAY
    );
    expect(found).toHaveLength(1);
    expect(found[0].hits).toBe(5);
  });
});

describe("how sure it is", () => {
  const RECENT = ["2026-05-11", "2026-06-11", "2026-07-11", "2026-08-11", "2026-09-09"];
  const STALE = ["2026-01-11", "2026-02-11", "2026-03-11", "2026-04-11"];

  it("is surer about a long steady run than a short wobbly one", () => {
    const [steady] = detectRecurring(monthly("Steady", 20, RECENT), TODAY);
    const [wobbly] = detectRecurring(monthly("Wobbly", [20, 27, 15], RECENT.slice(0, 3)), TODAY);
    expect(steady.confidence).toBeGreaterThan(wobbly.confidence);
  });

  it("loses confidence in one that stopped months ago", () => {
    const [live] = detectRecurring(monthly("Live", 20, RECENT), TODAY);
    const [stopped] = detectRecurring(monthly("Stopped", 20, STALE), TODAY);
    expect(stopped.confidence).toBeLessThan(live.confidence);
  });

  it("says outright whether it is still running", () => {
    const [live] = detectRecurring(monthly("Live", 20, RECENT), TODAY);
    const [stopped] = detectRecurring(monthly("Stopped", 20, STALE), TODAY);
    expect(isLive(live, TODAY)).toBe(true);
    expect(isLive(stopped, TODAY)).toBe(false);
  });
});

describe("when the next one lands", () => {
  it("counts a month on from the last one", () => {
    const [found] = detectRecurring(
      monthly("Spotify", 20.13, ["2026-06-11", "2026-07-11", "2026-08-11"]),
      TODAY
    );
    expect(nextDueOn(found)).toBe("2026-09-10");
  });
});

describe("the monthly figure", () => {
  it("turns any rhythm into what it costs per month", () => {
    expect(monthlyEquivalent(120, "yearly")).toBe(10);
    expect(monthlyEquivalent(30, "quarterly")).toBe(10);
    expect(monthlyEquivalent(100, "monthly")).toBe(100);
    expect(monthlyEquivalent(10, "weekly")).toBeCloseTo(43.33, 1);
  });

  it("adds subscriptions and obligations, and keeps transfers out", () => {
    // A card being paid off is money already counted when it was spent.
    // Including it would roughly double the answer.
    const MONTHS = ["2026-05-11", "2026-06-11", "2026-07-11", "2026-08-11", "2026-09-09"];
    const charges = detectRecurring(
      [
        ...monthly("Spotify", 20, MONTHS),
        ...monthly("State Farm", [210, 250, 305, 232, 256], MONTHS),
        ...monthly("DISCOVER E-PAYMENT 2747", 480, MONTHS),
      ],
      TODAY
    );
    const totals = monthlyTotals(charges);
    expect(totals.subscriptions).toBe(20);
    expect(totals.obligations).toBeGreaterThan(200);
    expect(totals.transfers).toBe(480);
    expect(totals.total).toBe(totals.subscriptions + totals.obligations);
  });
});

describe("the name a person would recognise", () => {
  it("digs the merchant out of the bank's formatting", () => {
    // The merchant survives; the terminal number, the timestamp and the
    // reference code do not.
    expect(tidyLabel("61358 RECURRING 08/01 12:59 HIGHLEVEL AGENCY GOHIGHLEVEL.C TX ECJBW1QY 06~5734")).toBe(
      "HIGHLEVEL AGENCY GOHIGHLEVEL.C TX"
    );
  });

  it("leaves an already-clean name alone", () => {
    expect(tidyLabel("Amazon Prime")).toBe("Amazon Prime");
  });

  it("keeps a name that is only digits rather than handing back a blank", () => {
    expect(tidyLabel("00000000")).toBe("00000000");
  });

  it("keeps a merchant whose name contains a number", () => {
    expect(tidyLabel("Shell 4471")).toBe("Shell");
  });
});
