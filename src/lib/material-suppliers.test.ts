import { describe, expect, it } from "vitest";

import { PRODUCTION_SERVICES, productionService } from "@/lib/forward-pricing";
import { deliveryFeeFor, milesBetween, pickSupplier, readSupplier, supplierKindFor, zipOf, type Supplier, type SupplierProduct } from "@/lib/material-suppliers";

const product = (over: Partial<SupplierProduct>): SupplierProduct => ({
  id: Math.random().toString(36).slice(2),
  kind: "mulch",
  name: "Mulch",
  unit: "yd",
  priceCents: null,
  deliveredPriceCents: null,
  imageUrl: null,
  productUrl: null,
  checkedOn: "2026-10-03",
  ...over,
});
const supplier = (over: Partial<Supplier>): Supplier => ({
  id: Math.random().toString(36).slice(2),
  name: "Supplier",
  address: null,
  lat: null,
  lng: null,
  phone: null,
  website: null,
  delivers: true,
  deliveryMinimum: 3,
  deliveryFees: [],
  deliveryNote: null,
  notes: null,
  sourceUrl: null,
  checkedOn: "2026-10-03",
  active: true,
  products: [],
  ...over,
});

// A job in Bel Air, and three suppliers at made-up distances from it.
const job = { lat: 39.536, lng: -76.352, zip: "21014" };
const near = supplier({ name: "Near, no prices", lat: 39.53, lng: -76.34, products: [product({ name: "Colored mulch" })], phone: "410-555-0100" });
const middle = supplier({
  name: "Middle",
  lat: 39.4859,
  lng: -76.4004,
  products: [product({ name: "Dyed black", priceCents: 3950 }), product({ name: "Double shredded", priceCents: 3450 }), product({ kind: "topsoil", name: "Screened topsoil", priceCents: 4900 })],
});
const far = supplier({
  name: "Far",
  lat: 39.42,
  lng: -76.35,
  deliveryFees: [{ town: "Bel Air", zips: ["21014", "21015"], feeCents: 4000 }],
  products: [
    product({ name: "Natural", priceCents: 3200, deliveredPriceCents: 3400 }),
    product({ kind: "stone", name: "#57 gray", unit: "ton", priceCents: 5100, deliveredPriceCents: 5700 }),
  ],
});
const suppliers = [far, middle, near];

describe("bulk suppliers for a job", () => {
  it("knows which bulk material a service uses", () => {
    expect(supplierKindFor(productionService("mulch-install")!)).toBe("mulch");
    expect(supplierKindFor(productionService("topsoil-install")!)).toBe("topsoil");
    expect(supplierKindFor(productionService("rock-install")!)).toBe("stone");
    expect(supplierKindFor(productionService("material-removal")!)).toBeNull();
    expect(supplierKindFor(productionService("seeding")!)).toBeNull();
    expect(PRODUCTION_SERVICES.filter((s) => supplierKindFor(s)).map((s) => s.key)).toEqual(["mulch-install", "rock-install", "topsoil-install"]);
  });

  it("measures miles and reads the zip code off an address", () => {
    // Bel Air to Fallston (Lehnhoff's) is about 4 miles as the crow flies.
    expect(milesBetween(job, { lat: 39.4858884, lng: -76.400381 })).toBeGreaterThan(3.5);
    expect(milesBetween(job, { lat: 39.4858884, lng: -76.400381 })).toBeLessThan(4.6);
    expect(zipOf("12 Main St, Bel Air, Maryland 21014, United States")).toBe("21014");
    expect(zipOf("No zip here")).toBeNull();
    expect(deliveryFeeFor(far, "21015")?.feeCents).toBe(4000);
    expect(deliveryFeeFor(far, "21078")).toBeNull();
  });

  it("recommends the closest with a price, its cheapest, and says to call a closer one with none", () => {
    const pick = pickSupplier(suppliers, "mulch", 6, job);
    expect(pick.all.map((o) => o.supplier.name)).toEqual(["Near, no prices", "Middle", "Far"]);
    expect(pick.recommended?.supplier.name).toBe("Middle");
    expect(pick.recommended?.product?.name).toBe("Double shredded");
    // No delivery fee published: the material only, picked-up price.
    expect(pick.recommended).toMatchObject({ amount: 6, amountUnit: "yd", delivery: null, underMinimum: false, costCents: 6 * 3450 });
    expect(pick.closerToCall.map((o) => o.supplier.name)).toEqual(["Near, no prices"]);
  });

  it("adds the delivery fee to the job's town, at the delivered price, and flags an order under the minimum", () => {
    const [option] = pickSupplier([far], "mulch", 2.2, job).all;
    expect(option).toMatchObject({ amount: 2.5, delivery: { town: "Bel Air" }, underMinimum: true, costCents: Math.round(2.5 * 3400 + 4000) });
  });

  it("orders stone sold by the ton at about 1.4 tons a yard", () => {
    const pick = pickSupplier(suppliers, "stone", 3, job);
    expect(pick.recommended).toMatchObject({ amountUnit: "ton", amount: 4.5, costCents: Math.round(4.5 * 5700 + 4000) });
  });

  it("without the job's position, recommends the cheapest, and lists who to call when nobody has a price", () => {
    expect(pickSupplier(suppliers, "mulch", 6, null).recommended?.supplier.name).toBe("Far");
    const none = pickSupplier([near], "mulch", 6, job);
    expect(none.recommended).toBeNull();
    expect(none.closerToCall.map((o) => o.supplier.name)).toEqual(["Near, no prices"]);
    expect(pickSupplier(suppliers, "sand", 6, job).all).toEqual([]);
    // One turned off is never recommended.
    expect(pickSupplier([{ ...middle, active: false }, far], "mulch", 6, job).recommended?.supplier.name).toBe("Far");
  });
});

describe("the Suppliers page's form", () => {
  it("keeps a good supplier, its delivery fees and products", () => {
    const read = readSupplier({
      name: " Wirtz & Daughters ",
      address: "12140 Pulaski Highway, Joppa, MD 21085",
      website: "https://wirtzanddaughters.com",
      deliveryMinimum: "3",
      deliveryFees: [{ town: "Bel Air", zips: "21014, 21015", feeCents: 4000 }, { town: "", zips: "", feeCents: "" }],
      products: [{ kind: "mulch", name: "Natural shredded", unit: "yd", priceCents: 3200, deliveredPriceCents: 3400, imageUrl: "javascript:alert(1)" }, { kind: "mulch", name: "" }],
    });
    expect(read.ok && read.supplier).toMatchObject({
      name: "Wirtz & Daughters",
      deliveryMinimum: 3,
      deliveryFees: [{ town: "Bel Air", zips: ["21014", "21015"], feeCents: 4000 }],
      products: [{ name: "Natural shredded", priceCents: 3200, deliveredPriceCents: 3400, imageUrl: null }],
    });
  });

  it("says what is wrong", () => {
    expect(readSupplier({ name: "" })).toEqual({ ok: false, error: "Give the supplier a name." });
    expect(readSupplier({ name: "A", deliveryFees: [{ town: "Bel Air", zips: "2101", feeCents: 4000 }] }).ok).toBe(false);
    expect(readSupplier({ name: "A", deliveryFees: [{ town: "Bel Air", zips: "21014" }] }).ok).toBe(false);
    expect(readSupplier({ name: "A", products: [{ kind: "lumber", name: "2x4" }] }).ok).toBe(false);
  });
});
