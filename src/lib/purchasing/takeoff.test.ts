import { describe, expect, it } from "vitest";

import {
  addDays,
  aggregateNeeds,
  groupIntoOrders,
  materialsLate,
  neededByDate,
  parseQuantityLabel,
  planTakeoff,
  poEmail,
  reorderAmount,
  resolveSource,
  shouldAutoApprove,
  statusAfterReceiving,
  toOrderUnit,
  type SourcingProduct,
  type SourcingSupplier,
} from "@/lib/purchasing/takeoff";

describe("parseQuantityLabel", () => {
  it("reads the number and unit off the labels the estimate writes", () => {
    expect(parseQuantityLabel("3.2 cubic yards (≈29 wheelbarrow loads) · $134.40")).toEqual({ quantity: 3.2, unit: "cubic yards" });
    expect(parseQuantityLabel("1,200 lb · $90.00")).toEqual({ quantity: 1200, unit: "lb" });
    expect(parseQuantityLabel("12 bags")).toEqual({ quantity: 12, unit: "bags" });
  });
  it("gives no quantity for a manual 'As needed' line rather than inventing one", () => {
    expect(parseQuantityLabel("As needed · $40.00")).toBeNull();
    expect(parseQuantityLabel("As needed")).toBeNull();
    expect(parseQuantityLabel("0 lb")).toBeNull();
  });
});

describe("aggregateNeeds", () => {
  const catalog = [
    { id: "m1", name: "Mulch", unit: "cubic yards" },
    { id: "m2", name: "Grass seed", unit: "lb" },
  ];
  it("adds the same material across areas and matches the catalogue by name", () => {
    const needs = aggregateNeeds(
      [
        { name: "Mulch", quantityLabel: "2.5 cubic yards · $100", costCents: 10000 },
        { name: "mulch ", quantityLabel: "1.25 cubic yards", costCents: null },
        { name: "Grass seed", quantityLabel: "As needed", costCents: null },
        { name: "Edging", quantityLabel: "40 ft", costCents: null },
      ],
      catalog
    );
    expect(needs).toEqual([
      { materialId: "m1", name: "Mulch", unit: "cubic yards", needed: 3.75 },
      { materialId: "m2", name: "Grass seed", unit: "lb", needed: null },
      { materialId: null, name: "Edging", unit: "ft", needed: 40 },
    ]);
  });
});

describe("planTakeoff", () => {
  it("takes from the shelf only what isn't promised to another job", () => {
    const lines = planTakeoff(
      [
        { materialId: "m1", name: "Mulch", unit: "cubic yards", needed: 6 },
        { materialId: "m2", name: "Seed", unit: "lb", needed: 10 },
      ],
      new Map([
        ["m1", { onHand: 8, reserved: 5 }],
        ["m2", { onHand: 50, reserved: 0 }],
      ])
    );
    expect(lines[0]).toMatchObject({ fromStock: 3, toOrder: 3 });
    expect(lines[1]).toMatchObject({ fromStock: 10, toOrder: 0 });
  });
  it("never takes negative stock, and flags unknowns", () => {
    const lines = planTakeoff(
      [
        { materialId: "m1", name: "Mulch", unit: "yd", needed: 2 },
        { materialId: null, name: "Edging", unit: "ft", needed: 40 },
        { materialId: "m3", name: "Fabric", unit: "roll", needed: null },
      ],
      new Map([["m1", { onHand: 1, reserved: 4 }]])
    );
    expect(lines[0]).toMatchObject({ fromStock: 0, toOrder: 2 });
    expect(lines[1].toOrder).toBe(40);
    expect(lines[1].note).toMatch(/Not in the materials list/);
    expect(lines[2]).toMatchObject({ toOrder: 0 });
    expect(lines[2].note).toMatch(/No quantity/);
  });
});

describe("resolveSource", () => {
  const suppliers: SourcingSupplier[] = [
    { id: "s1", name: "Yard A", email: "a@x.com", delivers: true, deliveryMinimum: 3, active: true },
    { id: "s2", name: "Yard B", email: null, delivers: true, deliveryMinimum: null, active: true },
    { id: "s3", name: "Closed", email: null, delivers: true, deliveryMinimum: null, active: false },
  ];
  const product = (p: Partial<SourcingProduct>): SourcingProduct => ({
    id: "p",
    supplierId: "s1",
    materialId: null,
    kind: "mulch",
    name: "Black mulch",
    unit: "yd",
    priceCents: 4000,
    deliveredPriceCents: null,
    preferred: false,
    active: true,
    ...p,
  });
  const mulch = { id: "m1", name: "Mulch", unit: "cubic yards", costPerUnit: 30, preferredSupplierId: null };

  it("prefers a linked, preferred product over a cheaper linked one", () => {
    const source = resolveSource(
      mulch,
      [product({ id: "cheap", supplierId: "s2", materialId: "m1", priceCents: 3000 }), product({ id: "pref", materialId: "m1", preferred: true })],
      suppliers
    );
    expect(source).toMatchObject({ supplierId: "s1", productId: "pref", how: "linked-preferred", unitCostCents: 4000 });
  });
  it("falls back to the material's own supplier, then to a product of the same kind", () => {
    expect(resolveSource({ ...mulch, preferredSupplierId: "s2" }, [], suppliers)).toMatchObject({ supplierId: "s2", how: "material-preferred", unitCostCents: 3000 });
    expect(resolveSource(mulch, [product({ id: "k", priceCents: 3500 })], suppliers)).toMatchObject({ productId: "k", how: "kind-match" });
  });
  it("ignores inactive suppliers and says nobody rather than guessing", () => {
    expect(resolveSource(mulch, [product({ supplierId: "s3", materialId: "m1" })], suppliers)).toMatchObject({ supplierId: null, how: "none" });
    expect(resolveSource({ id: "x", name: "Seed", unit: "lb", costPerUnit: null, preferredSupplierId: null }, [product({})], suppliers).how).toBe("none");
  });
});

describe("toOrderUnit", () => {
  it("converts yards of stone to tons, rounded up to the half", () => {
    expect(toOrderUnit(2, "cubic yards", "ton")).toBe(3);
    expect(toOrderUnit(2.2, "cubic yards", "yd")).toBe(2.5);
    expect(toOrderUnit(7.333, "lb", "lb")).toBe(7.33);
  });
});

describe("groupIntoOrders", () => {
  const suppliers: SourcingSupplier[] = [
    { id: "s1", name: "Yard A", email: "a@x.com", delivers: true, deliveryMinimum: 3, active: true },
    { id: "s2", name: "Shop B", email: null, delivers: false, deliveryMinimum: null, active: true },
  ];
  const line = (over: Record<string, unknown>) => ({
    materialId: "m",
    productId: null,
    name: "Mulch",
    quantity: 2,
    unit: "cubic yards",
    orderQuantity: 2,
    orderUnit: "yd",
    unitCostCents: 4000 as number | null,
    supplierId: "s1" as string | null,
    ...over,
  });

  it("makes one order per supplier and a separate order for the unsourced", () => {
    const orders = groupIntoOrders(
      [line({}), line({ name: "Topsoil" }), line({ supplierId: "s2", name: "Seed", orderUnit: "lb" }), line({ supplierId: null, name: "Edging" })],
      suppliers
    );
    expect(orders.map((o) => o.supplierId)).toEqual(["s1", "s2", null]);
    expect(orders[0].lines).toHaveLength(2);
    expect(orders[2].notes[0]).toMatch(/No supplier/);
  });
  it("turns an order under the delivery minimum into a pickup, and says so", () => {
    const [order] = groupIntoOrders([line({ orderQuantity: 2 })], suppliers);
    expect(order.fulfilment).toBe("pickup");
    expect(order.notes.join(" ")).toMatch(/under Yard A's 3 delivery minimum/);
    const [big] = groupIntoOrders([line({ orderQuantity: 2 }), line({ orderQuantity: 1.5 })], suppliers);
    expect(big.fulfilment).toBe("delivery");
  });
  it("is a pickup when the supplier doesn't deliver", () => {
    expect(groupIntoOrders([line({ supplierId: "s2" })], suppliers)[0].fulfilment).toBe("pickup");
  });
  it("totals in cents and knows when a line has no price", () => {
    const [order] = groupIntoOrders([line({ orderQuantity: 3, unitCostCents: 4000 }), line({ unitCostCents: null })], suppliers);
    expect(order.subtotalCents).toBe(12000);
    expect(order.fullyPriced).toBe(false);
  });
  it("drops zero-quantity lines", () => {
    expect(groupIntoOrders([line({ quantity: 0 })], suppliers)).toEqual([]);
  });
});

describe("shouldAutoApprove", () => {
  it("approves small, priced orders with a supplier only", () => {
    expect(shouldAutoApprove({ supplierId: "s", fullyPriced: true, subtotalCents: 49999 }, 50000)).toBe(true);
    expect(shouldAutoApprove({ supplierId: "s", fullyPriced: true, subtotalCents: 50000 }, 50000)).toBe(false);
    expect(shouldAutoApprove({ supplierId: "s", fullyPriced: false, subtotalCents: 100 }, 50000)).toBe(false);
    expect(shouldAutoApprove({ supplierId: null, fullyPriced: true, subtotalCents: 100 }, 50000)).toBe(false);
  });
});

describe("dates", () => {
  it("sets needed-by before the first work day", () => {
    expect(addDays("2026-11-02", -2)).toBe("2026-10-31");
    expect(neededByDate("2026-03-01", 2)).toBe("2026-02-27");
    expect(neededByDate(null, 2)).toBeNull();
  });
  it("calls materials late only inside the in-hand window with something not in hand", () => {
    const base = { firstWorkDay: "2026-10-20", daysBefore: 2 };
    expect(materialsLate({ ...base, today: "2026-10-17", orderStatuses: ["sent"] })).toBe(false);
    expect(materialsLate({ ...base, today: "2026-10-18", orderStatuses: ["sent"] })).toBe(true);
    expect(materialsLate({ ...base, today: "2026-10-18", orderStatuses: ["delivered", "picked_up", "cancelled"] })).toBe(false);
    expect(materialsLate({ ...base, today: "2026-10-21", orderStatuses: ["draft"] })).toBe(false);
    expect(materialsLate({ ...base, firstWorkDay: null, today: "2026-10-18", orderStatuses: ["draft"] })).toBe(false);
  });
});

describe("statusAfterReceiving", () => {
  it("is partial until every line is in", () => {
    expect(statusAfterReceiving([{ quantity: 3, received: 3 }, { quantity: 2, received: 1 }], "delivered")).toBe("partial");
    expect(statusAfterReceiving([{ quantity: 3, received: 3 }, { quantity: 2, received: 2 }], "picked_up")).toBe("picked_up");
    expect(statusAfterReceiving([{ quantity: 3, received: 0 }], "delivered")).toBe("confirmed");
  });
});

describe("reorderAmount", () => {
  it("counts what is already on order before reordering", () => {
    expect(reorderAmount({ onHand: 2, threshold: 5, onOrder: 4, reorderQuantity: null })).toBeNull();
    expect(reorderAmount({ onHand: 2, threshold: 5, onOrder: 0, reorderQuantity: null })).toBe(8);
    expect(reorderAmount({ onHand: 2, threshold: 5, onOrder: 1, reorderQuantity: 20 })).toBe(20);
  });
  it("does nothing without a threshold or a count", () => {
    expect(reorderAmount({ onHand: null, threshold: 5, onOrder: 0, reorderQuantity: null })).toBeNull();
    expect(reorderAmount({ onHand: 1, threshold: null, onOrder: 0, reorderQuantity: null })).toBeNull();
    expect(reorderAmount({ onHand: 5, threshold: 5, onOrder: 0, reorderQuantity: null })).toBeNull();
  });
});

describe("poEmail", () => {
  it("lists the lines in the supplier's units and says delivery or pickup", () => {
    const email = poEmail({
      businessName: "JS Landscaping",
      businessPhone: "410-555-0100",
      poNumber: 42,
      supplierName: "Yard A",
      fulfilment: "delivery",
      neededBy: "2026-10-18",
      deliverTo: "12 Main St, Bel Air MD 21014",
      lines: [{ name: "Black mulch", orderQuantity: 3.5, orderUnit: "yd" }],
      notes: null,
    });
    expect(email.subject).toBe("Purchase order 42 from JS Landscaping");
    expect(email.text).toContain("- 3.5 yd Black mulch");
    expect(email.text).toContain("Please deliver by 2026-10-18 to 12 Main St");
    const pickup = poEmail({ businessName: "B", businessPhone: null, poNumber: 1, supplierName: "S", fulfilment: "pickup", neededBy: null, deliverTo: null, lines: [], notes: "Gate code 1234" });
    expect(pickup.text).toContain("We'll pick this up.");
    expect(pickup.text).toContain("Gate code 1234");
  });
});
