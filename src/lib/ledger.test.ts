import { describe, expect, it } from "vitest";

import { categoriesFor, categoryLabel, isValidPairing, totalLedger } from "@/lib/ledger";
import type { LedgerCategory, LedgerDirection } from "@/types/domain";

function entry(direction: LedgerDirection, category: LedgerCategory, amount: number) {
  return { direction, category, amount };
}

describe("categoriesFor", () => {
  it("never offers an income category for an expense", () => {
    const expense = categoriesFor("out").map((c) => c.value);
    expect(expense).not.toContain("job_payment");
    expect(expense).not.toContain("deposit");
  });

  it("never offers an expense category for income", () => {
    const income = categoriesFor("in").map((c) => c.value);
    expect(income).not.toContain("materials");
    expect(income).not.toContain("fuel");
  });
});

describe("isValidPairing", () => {
  it("rejects a category filed under the wrong direction", () => {
    // The database has the same constraint; this catches it before the trip.
    expect(isValidPairing("in", "fuel")).toBe(false);
    expect(isValidPairing("out", "job_payment")).toBe(false);
  });

  it("accepts each category under its own direction", () => {
    for (const c of categoriesFor("in")) expect(isValidPairing("in", c.value)).toBe(true);
    for (const c of categoriesFor("out")) expect(isValidPairing("out", c.value)).toBe(true);
  });
});

describe("categoryLabel", () => {
  it("reads back a human label", () => {
    expect(categoryLabel("subcontractor")).toBe("Subcontractor");
  });

  it("falls back to the raw value rather than showing nothing", () => {
    expect(categoryLabel("something_new")).toBe("something_new");
  });
});

describe("totalLedger", () => {
  it("separates the two directions", () => {
    const totals = totalLedger([
      entry("in", "job_payment", 4000),
      entry("in", "deposit", 1000),
      entry("out", "materials", 1200),
    ]);
    expect(totals.in).toBe(5000);
    expect(totals.out).toBe(1200);
    expect(totals.net).toBe(3800);
  });

  it("goes negative when more went out than came in", () => {
    const totals = totalLedger([entry("in", "job_payment", 500), entry("out", "equipment", 2000)]);
    expect(totals.net).toBe(-1500);
  });

  it("adds up cents without drifting", () => {
    const totals = totalLedger([
      entry("in", "job_payment", 0.1),
      entry("in", "job_payment", 0.2),
    ]);
    expect(totals.in).toBe(0.3);
  });

  it("leaves out categories with nothing in them", () => {
    const totals = totalLedger([entry("out", "fuel", 80)]);
    expect(totals.byCategory).toHaveLength(1);
    expect(totals.byCategory[0].category).toBe("fuel");
  });

  it("puts the biggest category first", () => {
    const totals = totalLedger([
      entry("out", "fuel", 80),
      entry("out", "materials", 3000),
      entry("out", "permit", 150),
    ]);
    expect(totals.byCategory.map((c) => c.category)).toEqual(["materials", "permit", "fuel"]);
  });

  it("tags each breakdown line with the direction it belongs to", () => {
    const totals = totalLedger([entry("in", "deposit", 900), entry("out", "materials", 100)]);
    expect(totals.byCategory.find((c) => c.category === "deposit")?.direction).toBe("in");
    expect(totals.byCategory.find((c) => c.category === "materials")?.direction).toBe("out");
  });

  it("totals an empty ledger to zero rather than failing", () => {
    expect(totalLedger([])).toEqual({ in: 0, out: 0, net: 0, byCategory: [] });
  });
});
