import { describe, expect, it } from "vitest";

import { countOf, money, valueInventory, type ValuedTool } from "@/lib/inventory-value";

function tool(over: Partial<ValuedTool> = {}): ValuedTool {
  return {
    name: "Trimmer",
    cost: 300,
    resaleValue: null,
    isRental: false,
    quantity: 1,
    costToOwn: null,
    ...over,
  };
}

describe("countOf", () => {
  it("treats an unsaid quantity as one", () => {
    expect(countOf({ quantity: null })).toBe(1);
  });

  it("takes nothing from a quantity of none", () => {
    expect(countOf({ quantity: 0 })).toBe(0);
    expect(countOf({ quantity: -3 })).toBe(0);
  });
});

describe("valueInventory", () => {
  it("adds up what was spent and what it would fetch", () => {
    const out = valueInventory([tool({ cost: 300 }), tool({ name: "Mower", cost: 700 })]);
    expect(out.purchase).toBe(1000);
    expect(out.sell).toBe(100);
    expect(out.items).toBe(2);
    expect(out.priced).toBe(2);
  });

  it("counts three of a thing as three", () => {
    const out = valueInventory([tool({ cost: 300, quantity: 3 })]);
    expect(out.purchase).toBe(900);
    expect(out.sell).toBe(90);
    expect(out.items).toBe(3);
  });

  it("leaves a rental out of both totals, because it was never ours", () => {
    const out = valueInventory([tool({ name: "Skid steer", cost: 400, isRental: true, costToOwn: 45000 })]);
    expect(out.purchase).toBe(0);
    expect(out.sell).toBe(0);
    expect(out.items).toBe(0);
    expect(out.rentals).toBe(1);
    expect(out.rentalBuyout).toBe(45000);
  });

  it("says how many owned tools carry no price, rather than treating them as free", () => {
    const out = valueInventory([tool({ cost: 300 }), tool({ name: "Rake", cost: null })]);
    expect(out.purchase).toBe(300);
    expect(out.unpriced).toBe(1);
    expect(out.unpricedNames).toEqual(["Rake"]);
    // Still an item we own, even without a price on it.
    expect(out.items).toBe(2);
  });

  it("takes a resale figure somebody set by hand over the default share", () => {
    const out = valueInventory([tool({ cost: 300, resaleValue: 250 })]);
    expect(out.sell).toBe(250);
  });

  it("takes a hand-set resale figure even where nobody recorded a cost", () => {
    const out = valueInventory([tool({ cost: null, resaleValue: 120 })]);
    expect(out.purchase).toBe(0);
    expect(out.sell).toBe(120);
    expect(out.unpriced).toBe(1);
  });

  it("names only the first few, so the line stays a line", () => {
    const out = valueInventory(
      Array.from({ length: 10 }, (_, i) => tool({ name: `Thing ${i}`, cost: null }))
    );
    expect(out.unpriced).toBe(10);
    expect(out.unpricedNames).toHaveLength(6);
  });

  it("rounds once at the end rather than on every row", () => {
    // A tenth of 333.33 is 33.333, which rounds to 33.33 a row. Three of them
    // must come to 99.99, not 100.
    const out = valueInventory([
      tool({ cost: 333.33 }),
      tool({ cost: 333.33 }),
      tool({ cost: 333.33 }),
    ]);
    expect(out.purchase).toBe(999.99);
    expect(out.sell).toBe(99.99);
  });

  it("comes back at zero for an empty shed rather than blowing up", () => {
    const out = valueInventory([]);
    expect(out.purchase).toBe(0);
    expect(out.sell).toBe(0);
    expect(out.items).toBe(0);
  });
});

describe("money", () => {
  it("drops the cents, because nobody reads them on a shed full of tools", () => {
    expect(money(1234.56)).toBe("$1,235");
  });
});
