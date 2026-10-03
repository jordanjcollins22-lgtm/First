import { describe, expect, it } from "vitest";

import { buyAmount, itemsFor, jobMaterials, type InventoryItem } from "@/lib/forward-materials";
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

  it("works out how much to buy in the item's own unit, waste in", () => {
    // 810 sq ft + 10% over 5,000 a bag is one bag; 6,000 is two.
    expect(buyAmount(seed, 810, "SF")).toBe("1 bag");
    expect(buyAmount(seed, 6000, "SF")).toBe("2 bag");
    // 2.5 yards + 10% is 2.75, to the next half yard.
    expect(buyAmount(topsoil, 2.5, "CY")).toBe("3 cu yd");
    expect(buyAmount(straw, 810, "SF")).toBeNull();
    // Sold by the pound: the coverage is per bag, so it can't be said.
    expect(buyAmount(item({ unit: "lbs", coverageSqFt: 8000 }), 810, "SF")).toBeNull();
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
    expect(rows[0].items[0].buy).toBe("1 bag");
  });
});
