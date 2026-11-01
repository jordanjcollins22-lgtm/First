import { describe, expect, it } from "vitest";

import { kindOfMaterial, materialCost, withRealCosts, type ListedProduct } from "@/lib/material-costs";

const product = (over: Partial<ListedProduct> = {}): ListedProduct => ({
  kind: "mulch",
  name: "Natural triple shredded mulch",
  unit: "yd",
  priceCents: 3700,
  deliveredPriceCents: null,
  active: true,
  preferred: false,
  materialId: null,
  supplier: "Lehnhoff's Supply",
  ...over,
});
const mulch = { id: "m1", name: "Mulch", unit: "cubic yards", cost_per_unit: null as number | null };

describe("materialCost", () => {
  it("keeps the material's own cost when it is set", () => {
    expect(materialCost({ ...mulch, cost_per_unit: 30 }, [product()])).toEqual({ perUnit: 30, from: "your materials list" });
  });

  it("reads a blank cost off the supplier list, the dearest of the same kind", () => {
    const list = [product(), product({ name: "Dyed black mulch", priceCents: 4200 }), product({ name: "No price", priceCents: null })];
    expect(materialCost(mulch, list)).toEqual({ perUnit: 42, from: "Lehnhoff's Supply, Dyed black mulch, $42/yd" });
  });

  it("takes the preferred product over a dearer one", () => {
    const list = [product({ preferred: true }), product({ name: "Dyed black mulch", priceCents: 4200 })];
    expect(materialCost(mulch, list)?.perUnit).toBe(37);
  });

  it("takes a product set as this material's source over others of its kind", () => {
    const list = [product({ materialId: "m1", priceCents: 3300 }), product({ name: "Dyed", priceCents: 4200 })];
    expect(materialCost(mulch, list)?.perUnit).toBe(33);
  });

  it("never puts a price per ton on a yard", () => {
    expect(materialCost({ id: "r", name: "Rock", unit: "cubic yards", cost_per_unit: null }, [product({ kind: "stone", unit: "ton", priceCents: 6300 })])).toBeNull();
  });

  it("skips switched-off products and ones with no price", () => {
    expect(materialCost(mulch, [product({ active: false }), product({ priceCents: null })])).toBeNull();
  });

  it("uses a delivered price when that is the only one", () => {
    expect(materialCost(mulch, [product({ priceCents: null, deliveredPriceCents: 5500 })])?.perUnit).toBe(55);
  });
});

describe("kindOfMaterial", () => {
  it("reads the kind off the name", () => {
    expect(kindOfMaterial("Black mulch")).toBe("mulch");
    expect(kindOfMaterial("Topsoil")).toBe("topsoil");
    expect(kindOfMaterial("River rock")).toBe("stone");
    expect(kindOfMaterial("Grass seed")).toBeNull();
  });
});

describe("withRealCosts", () => {
  it("fills only the blanks, and says where each came from", () => {
    const out = withRealCosts([mulch, { id: "r", name: "Rock", unit: "cubic yards", cost_per_unit: 150 }], [product({ priceCents: 4200 })]);
    expect(out[0]).toMatchObject({ cost_per_unit: 42, cost_from: "Lehnhoff's Supply, Natural triple shredded mulch, $42/yd" });
    expect(out[1]).toEqual({ id: "r", name: "Rock", unit: "cubic yards", cost_per_unit: 150 });
  });
});
