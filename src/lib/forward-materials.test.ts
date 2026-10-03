import { describe, expect, it } from "vitest";

import { bulkOrders, itemsFor, jobMaterials, purchaseFor, purchaseNoun, splitCost, type InventoryItem } from "@/lib/forward-materials";
import { PRODUCTION_SERVICES, productionService } from "@/lib/forward-pricing";

const item = (over: Partial<InventoryItem>): InventoryItem => ({ id: "00000000-0000-0000-0000-000000000000", name: "Item", unit: null, imageUrl: null, url: null, coverageSqFt: null, wastePct: 0, ...over });

const seed = item({ id: "11111111-1111-1111-1111-111111111111", name: "Kentucky 31 tall fescue grass seed, 40 lbs", unit: "bag", url: "https://example.com/seed", coverageSqFt: 5000, wastePct: 10 });
const oldSeed = item({ id: "22222222-2222-2222-2222-222222222222", name: "Grass seed", unit: "lb" });
const straw = item({ id: "33333333-3333-3333-3333-333333333333", name: "Straw", unit: "bale" });
const topsoil = item({ id: "44444444-4444-4444-4444-444444444444", name: "Topsoil", unit: "cubic yards", url: "https://example.com/topsoil", wastePct: 10 });
const inventory = [seed, oldSeed, straw, topsoil];

describe("materials matched to the inventory", () => {
  it("finds each word of the material, preferring an item with a link to buy it", () => {
    expect(itemsFor(productionService("seeding")!, inventory).map((i) => i.name)).toEqual([seed.name, "Straw"]);
    expect(itemsFor(productionService("topsoil-install")!, inventory)).toEqual([topsoil]);
  });

  it("uses the items picked on Production rates, and none when all were taken off", () => {
    const seeding = productionService("seeding")!;
    expect(itemsFor({ ...seeding, materialIds: [oldSeed.id] }, inventory)).toEqual([oldSeed]);
    expect(itemsFor({ ...seeding, materialIds: [] }, inventory)).toEqual([]);
  });

  it("says how many to buy, waste in", () => {
    const seeding = productionService("seeding")!;
    const topsoilSvc = productionService("topsoil-install")!;
    // 810 sq ft + 10% over 5,000 a bag is one bag; 6,000 is two.
    expect(purchaseFor(seed, seeding, 810)?.text).toBe("1 bag");
    expect(purchaseFor(seed, seeding, 6000)?.text).toBe("2 bags");
    // Sold by the yard: 2.5 yards + 10% is 2.75, to the next half yard.
    expect(purchaseFor(topsoil, topsoilSvc, 2.5)?.text).toBe("3 cu yd");
    // In 0.75 cu ft bags: 2.5 yards + 10% is 74.25 cu ft, 99 bags.
    expect(purchaseFor(topsoil, { ...topsoilSvc, materialHolds: { [topsoil.id]: 0.75 / 27 } }, 2.5)).toMatchObject({ count: 99, noun: "bag", text: "99 bags" });
    // Nothing says how much a bale of straw covers.
    expect(purchaseFor(straw, seeding, 810)).toBeNull();
    expect(purchaseFor(straw, { ...seeding, materialHolds: { [straw.id]: 500 } }, 810)?.text).toBe("2 bales");
  });

  it("names a purchase by what it is carried in", () => {
    expect(purchaseNoun(straw)).toBe("bale");
    expect(purchaseNoun(item({ unit: "lbs" }))).toBe("bag");
    expect(purchaseNoun(item({ unit: "cubic yards" }))).toBe("bag");
    expect(purchaseNoun(item({ unit: "1 Roll" }))).toBe("roll");
  });

  it("orders from the bulk supplier over the threshold, and by the bag under it", () => {
    const bulk = item({ id: "55555555-5555-5555-5555-555555555555", name: "Screened topsoil, by the yard", unit: "cubic yards", url: "https://example.com/bulk", wastePct: 10 });
    const services = PRODUCTION_SERVICES.map((s) => (s.key === "topsoil-install" ? { ...s, materialIds: [topsoil.id], materialHolds: { [topsoil.id]: 0.75 / 27 }, bulkMaterialId: bulk.id } : s));
    const [small, big] = jobMaterials(["Zone 1", "Zone 2"], [[{ key: "topsoil-install", quantity: 0.5, materialCents: 0 }], [{ key: "topsoil-install", quantity: 2.5, materialCents: 0 }]], services, [topsoil, bulk]);
    expect(small.bulk).toBeNull();
    expect(small.items[0].buy?.text).toBe("20 bags");
    expect(big.bulk).toEqual({ over: 1, item: bulk, amount: "3 cu yd" });
    // No bulk product picked yet: still says to order in bulk, and how much.
    const [none] = jobMaterials(["Zone 1"], [[{ key: "topsoil-install", quantity: 2.5, materialCents: 0 }]], PRODUCTION_SERVICES, [topsoil]);
    expect(none.bulk).toMatchObject({ over: 1, item: null, amount: "3 cu yd" });
  });

  it("lists each line with a material, leaving out disposal", () => {
    const rows = jobMaterials(
      ["Zone 1", "Zone 2"],
      [
        [{ key: "seeding", quantity: 810, materialCents: 2430 }, { key: "disposal", quantity: 1, materialCents: 4000 }],
        [{ key: "weed-pulling", quantity: 100, materialCents: 0 }, { key: "weed-spraying", quantity: 100, materialCents: 200 }],
      ],
      PRODUCTION_SERVICES,
      inventory
    );
    expect(rows.map((r) => [r.areaName, r.service, r.items.length])).toEqual([
      ["Zone 1", "Seeding (seed, rake in, straw)", 2],
      ["Zone 2", "Weed spraying", 0],
    ]);
    expect(rows[0].items[0].buy?.text).toBe("1 bag");
  });

  it("adds a material up across the job into one bulk order, and shares its cost back by quantity", () => {
    // Two beds of 0.8 yd: each under the 1 yd threshold, 1.6 together.
    const rows = jobMaterials(
      ["Zone 1", "Zone 2", "Zone 3"],
      [[{ key: "mulch-install", quantity: 0.8, materialCents: 0 }], [{ key: "weed-pulling", quantity: 100, materialCents: 0 }, { key: "mulch-install", quantity: 0.8, materialCents: 0 }], [{ key: "seeding", quantity: 500, materialCents: 0 }]],
      PRODUCTION_SERVICES,
      inventory
    );
    const { orders, rest } = bulkOrders(rows);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ kind: "mulch", quantity: 1.6, over: 1 });
    expect(orders[0].rows.map((r) => [r.area, r.line])).toEqual([[0, 0], [1, 1]]);
    expect(rest.map((r) => r.service)).toEqual(["Seeding (seed, rake in, straw)"]);
    expect(splitCost(orders[0], 10001)).toEqual([{ area: 0, line: 0, cents: 5001 }, { area: 1, line: 1, cents: 5000 }]);
    // One small bed stays bought by the bag.
    expect(bulkOrders(jobMaterials(["Zone 1"], [[{ key: "mulch-install", quantity: 0.5, materialCents: 0 }]], PRODUCTION_SERVICES, inventory)).orders).toEqual([]);
  });
});
