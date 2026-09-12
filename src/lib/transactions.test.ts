import { describe, expect, it } from "vitest";

import {
  anyFilter,
  applyFilters,
  byMonth,
  categoryLabel,
  directionOf,
  filtersFromParams,
  matches,
  NO_FILTERS,
  spendByCategory,
  spendByMerchant,
  totalsOf,
  type Transaction,
} from "@/lib/transactions";

function txn(over: Partial<Transaction> = {}): Transaction {
  return {
    id: "t1",
    who: "Home Depot",
    amount: 120,
    postedOn: "2026-06-15",
    accountId: "card",
    accountName: "Blue Business Cash ••1001",
    category: "HOME_IMPROVEMENT",
    pending: false,
    recurring: false,
    ...over,
  };
}

describe("which way the money went", () => {
  it("calls a positive amount money out, the way the bank does", () => {
    expect(directionOf({ amount: 120 })).toBe("out");
    expect(directionOf({ amount: -500 })).toBe("in");
  });
});

describe("the bank's category, said out loud", () => {
  it("turns shouting into a sentence", () => {
    expect(categoryLabel("HOME_IMPROVEMENT")).toBe("Home improvement");
    expect(categoryLabel("FOOD_AND_DRINK")).toBe("Food and drink");
  });

  it("says something rather than nothing when the bank did not label it", () => {
    expect(categoryLabel(null)).toBe("Uncategorised");
  });
});

describe("filtering", () => {
  it("shows everything when nothing is set", () => {
    // A screen that opens on nothing because a default was set is a screen
    // people assume is broken.
    expect(matches(txn(), NO_FILTERS)).toBe(true);
  });

  it("finds a merchant by part of its name", () => {
    expect(matches(txn(), { ...NO_FILTERS, query: "depot" })).toBe(true);
    expect(matches(txn(), { ...NO_FILTERS, query: "walmart" })).toBe(false);
  });

  it("takes words in any order, because that is how people type", () => {
    expect(matches(txn(), { ...NO_FILTERS, query: "depot blue" })).toBe(true);
    expect(matches(txn(), { ...NO_FILTERS, query: "blue depot" })).toBe(true);
  });

  it("searches the account and the category too", () => {
    expect(matches(txn(), { ...NO_FILTERS, query: "platinum" })).toBe(false);
    expect(matches(txn(), { ...NO_FILTERS, query: "improvement" })).toBe(true);
  });

  it("narrows to one account", () => {
    expect(matches(txn(), { ...NO_FILTERS, accountId: "card" })).toBe(true);
    expect(matches(txn(), { ...NO_FILTERS, accountId: "checking" })).toBe(false);
  });

  it("narrows to one direction", () => {
    expect(matches(txn({ amount: -400 }), { ...NO_FILTERS, direction: "in" })).toBe(true);
    expect(matches(txn({ amount: -400 }), { ...NO_FILTERS, direction: "out" })).toBe(false);
  });

  it("narrows to a date range, both ends included", () => {
    const filters = { ...NO_FILTERS, from: "2026-06-15", to: "2026-06-15" };
    expect(matches(txn({ postedOn: "2026-06-15" }), filters)).toBe(true);
    expect(matches(txn({ postedOn: "2026-06-14" }), filters)).toBe(false);
    expect(matches(txn({ postedOn: "2026-06-16" }), filters)).toBe(false);
  });

  it("narrows to the ones that come back", () => {
    expect(matches(txn({ recurring: true }), { ...NO_FILTERS, recurringOnly: true })).toBe(true);
    expect(matches(txn({ recurring: false }), { ...NO_FILTERS, recurringOnly: true })).toBe(false);
  });

  it("stacks filters rather than choosing between them", () => {
    const filters = { ...NO_FILTERS, query: "depot", direction: "out" as const, accountId: "card" };
    expect(matches(txn(), filters)).toBe(true);
    expect(matches(txn({ accountId: "checking" }), filters)).toBe(false);
  });

  it("puts the newest first, which is where somebody looks", () => {
    const rows = applyFilters(
      [txn({ id: "old", postedOn: "2026-05-01" }), txn({ id: "new", postedOn: "2026-08-01" })],
      NO_FILTERS
    );
    expect(rows.map((r) => r.id)).toEqual(["new", "old"]);
  });
});

describe("what it comes to", () => {
  it("counts both directions rather than one signed number", () => {
    // "We spent 600 and took 1,000" and "we were up 400" are different
    // sentences, and only the first says where to look.
    const totals = totalsOf([txn({ amount: 200 }), txn({ amount: 400 }), txn({ amount: -1000 })]);
    expect(totals.out).toBe(600);
    expect(totals.in).toBe(1000);
    expect(totals.net).toBe(400);
    expect(totals.count).toBe(3);
  });

  it("comes back at zero for nothing at all", () => {
    expect(totalsOf([])).toEqual({ out: 0, in: 0, net: 0, count: 0 });
  });
});

describe("split into months", () => {
  it("groups by month, newest month first, with a subtotal each", () => {
    const groups = byMonth([
      txn({ id: "a", postedOn: "2026-06-15", amount: 100 }),
      txn({ id: "b", postedOn: "2026-06-20", amount: 50 }),
      txn({ id: "c", postedOn: "2026-07-02", amount: 25 }),
    ]);
    expect(groups.map((g) => g.month)).toEqual(["2026-07", "2026-06"]);
    expect(groups[1].totals.out).toBe(150);
    expect(groups[0].label).toBe("July 2026");
  });
});

describe("where the money went", () => {
  it("adds spending up by category, biggest first", () => {
    const totals = spendByCategory([
      txn({ amount: 100, category: "HOME_IMPROVEMENT" }),
      txn({ amount: 400, category: "GENERAL_MERCHANDISE" }),
      txn({ amount: 50, category: "HOME_IMPROVEMENT" }),
    ]);
    expect(totals[0].label).toBe("General merchandise");
    expect(totals[1].out).toBe(150);
  });

  it("leaves money coming in out of a spending total", () => {
    expect(spendByCategory([txn({ amount: -900 })])).toEqual([]);
  });

  it("adds spending up by merchant, biggest first", () => {
    const totals = spendByMerchant([
      txn({ who: "Home Depot", amount: 100 }),
      txn({ who: "home depot", amount: 200 }),
      txn({ who: "Walmart", amount: 250 }),
    ]);
    // Home Depot twice comes to 300, which beats Walmart's 250 — and the two
    // spellings are one merchant.
    expect(totals[0].who).toBe("Home Depot");
    expect(totals[0].out).toBe(300);
    expect(totals[0].count).toBe(2);
    expect(totals[1].who).toBe("Walmart");
  });
});

describe("filters that travel in a URL", () => {
  it("reads them back, so a filtered view can be sent to somebody", () => {
    const filters = filtersFromParams({
      q: "home depot",
      account: "card",
      direction: "out",
      from: "2026-06-01",
      recurring: "1",
    });
    expect(filters.query).toBe("home depot");
    expect(filters.accountId).toBe("card");
    expect(filters.direction).toBe("out");
    expect(filters.from).toBe("2026-06-01");
    expect(filters.recurringOnly).toBe(true);
  });

  it("ignores a direction it does not know rather than showing nothing", () => {
    expect(filtersFromParams({ direction: "sideways" }).direction).toBeNull();
  });

  it("treats blank as unset", () => {
    expect(filtersFromParams({ q: "   ", account: "" })).toEqual(NO_FILTERS);
  });

  it("knows when something is narrowing the list", () => {
    expect(anyFilter(NO_FILTERS)).toBe(false);
    expect(anyFilter({ ...NO_FILTERS, query: "x" })).toBe(true);
    expect(anyFilter({ ...NO_FILTERS, recurringOnly: true })).toBe(true);
  });
});
