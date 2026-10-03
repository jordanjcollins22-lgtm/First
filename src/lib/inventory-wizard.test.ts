import { describe, expect, it } from "vitest";

import {
  EMPTY_ANSWERS,
  fieldsFor,
  outstanding,
  problemWith,
  stepsFor,
  type WizardAnswers,
} from "@/lib/inventory-wizard";

const answers = (over: Partial<WizardAnswers> = {}): WizardAnswers => ({ ...EMPTY_ANSWERS, ...over });
const ids = (a: WizardAnswers) => stepsFor(a).map((s) => s.id);

describe("what gets asked", () => {
  it("always starts with what it is and what it is called", () => {
    expect(ids(answers()).slice(0, 2)).toEqual(["kind", "name"]);
  });

  it("always ends on a review", () => {
    for (const kind of ["tool", "material", "other"] as const) {
      const list = ids(answers({ kind }));
      expect(list[list.length - 1], kind).toBe("review");
    }
  });

  it("asks a tool whether we own it", () => {
    expect(ids(answers({ kind: "tool" }))).toContain("ownership");
  });

  it("does not ask that of a material or a fee", () => {
    expect(ids(answers({ kind: "material" }))).not.toContain("ownership");
    expect(ids(answers({ kind: "other" }))).not.toContain("ownership");
  });

  it("asks a material what one of it is, and does not ask a tool", () => {
    // One mower is one mower.
    expect(ids(answers({ kind: "material" }))).toContain("unit");
    expect(ids(answers({ kind: "tool" }))).not.toContain("unit");
  });

  it("never asks a fee where it is kept — nobody shelves a permit", () => {
    const list = ids(answers({ kind: "other" }));
    expect(list).not.toContain("stock_method");
    expect(list).not.toContain("where");
    expect(list).not.toContain("levels");
  });

  it("skips storage and levels for something ordered as needed", () => {
    const list = ids(answers({ kind: "material", stockMethod: "order_as_needed" }));
    expect(list).toContain("stock_method");
    expect(list).not.toContain("where");
    expect(list).not.toContain("levels");
  });

  it("asks where it is kept once it is kept in stock", () => {
    const list = ids(answers({ kind: "material", stockMethod: "in_stock" }));
    expect(list).toContain("where");
    expect(list).toContain("levels");
  });

  it("asks about kits only for tools", () => {
    expect(ids(answers({ kind: "tool" }))).toContain("kits");
    expect(ids(answers({ kind: "material" }))).not.toContain("kits");
  });

  it("asks a rental what a day costs, not what it costs to buy", () => {
    const rented = stepsFor(answers({ kind: "tool", ownership: "rent" })).find((s) => s.id === "cost");
    const owned = stepsFor(answers({ kind: "tool", ownership: "own" })).find((s) => s.id === "cost");
    expect(rented?.title).toMatch(/per day/i);
    expect(owned?.title).not.toMatch(/per day/i);
  });

  it("asks coverage only where it could mean something", () => {
    expect(ids(answers({ kind: "material" }))).toContain("coverage");
    expect(ids(answers({ kind: "other" }))).not.toContain("coverage");
    expect(ids(answers({ kind: "tool" }))).not.toContain("coverage");
  });
});

describe("what has to be answered", () => {
  it("will not take a nameless thing", () => {
    expect(problemWith("name", answers({ name: "  " }))).toMatch(/name/i);
    expect(problemWith("name", answers({ name: "Pea gravel" }))).toBeNull();
  });

  it("insists on a photo", () => {
    expect(problemWith("photo", answers())).toBeTruthy();
    expect(problemWith("photo", answers({ photo: "blob:x" }))).toBeNull();
  });

  it("insists on where it is kept, which is the one everybody skips", () => {
    expect(problemWith("where", answers())).toBeTruthy();
    expect(problemWith("where", answers({ storageLocation: "Trailer" }))).toBeNull();
  });

  it("takes a price either way round", () => {
    expect(problemWith("cost", answers())).toBeTruthy();
    expect(problemWith("cost", answers({ unitCost: "0.12" }))).toBeNull();
    expect(problemWith("cost", answers({ packSize: "250", packCost: "30" }))).toBeNull();
    // Half a pack price is not a price.
    expect(problemWith("cost", answers({ packSize: "250" }))).toBeTruthy();
  });

  it("lets the optional ones through empty", () => {
    expect(problemWith("coverage", answers())).toBeNull();
    expect(problemWith("kits", answers())).toBeNull();
    expect(problemWith("buying", answers())).toBeNull();
  });

  it("lists everything still missing, so the review owns up to it", () => {
    expect(outstanding(answers({ kind: "material" })).length).toBeGreaterThan(0);
    const done = answers({
      kind: "material",
      name: "Cardstock",
      photo: "blob:x",
      unit: "sheet",
      unitCost: "0.12",
      stockMethod: "in_stock",
      storageLocation: "Shop",
    });
    expect(outstanding(done)).toEqual([]);
  });
});

describe("the fields it produces", () => {
  it("writes a tool the way the tool action expects", () => {
    const fields = fieldsFor(
      answers({
        kind: "tool",
        name: "Chainsaw",
        ownership: "rent",
        unitCost: "85",
        kits: [1, 3],
        stockMethod: "in_stock",
        storageLocation: "Trailer",
        quantityOnHand: "2",
        reorderThreshold: "1",
      })
    );
    expect(fields).toMatchObject({
      name: "Chainsaw",
      cost: "85",
      is_rental: "on",
      kits: "1,3",
      quantity: "2",
      reorder_threshold: "1",
      storage_location: "Trailer",
      stock_method: "in_stock",
    });
    // A tool has no unit and no pack price.
    expect(fields.unit).toBeUndefined();
    expect(fields.pack_size).toBeUndefined();
  });

  it("leaves is_rental empty for something we own", () => {
    expect(fieldsFor(answers({ kind: "tool", ownership: "own" })).is_rental).toBe("");
  });

  it("writes a material the way the material action expects", () => {
    const fields = fieldsFor(
      answers({
        kind: "material",
        name: "Cardstock",
        unit: "sheet",
        packSize: "250",
        packCost: "30",
        coverage: "1",
        stockMethod: "in_stock",
        storageLocation: "Shop",
        quantityOnHand: "400",
        reorderThreshold: "500",
      })
    );
    expect(fields).toMatchObject({
      name: "Cardstock",
      unit: "sheet",
      kind: "material",
      pack_size: "250",
      pack_cost: "30",
      coverage_per_unit_sqft: "1",
      quantity_on_hand: "400",
      reorder_threshold: "500",
      waste_factor_pct: "10",
    });
  });

  it("marks a fee as other and never as stock", () => {
    // Even if in_stock was picked before the kind was changed to a fee.
    const fields = fieldsFor(
      answers({ kind: "other", name: "EDDM postage", unit: "each", unitCost: "0.25", stockMethod: "in_stock", storageLocation: "Shop" })
    );
    expect(fields.kind).toBe("other");
    expect(fields.stock_method).toBe("order_as_needed");
    expect(fields.storage_location).toBe("");
  });

  it("does not send a storage location for something ordered as needed", () => {
    const fields = fieldsFor(
      answers({ kind: "material", stockMethod: "order_as_needed", storageLocation: "Shop" })
    );
    expect(fields.storage_location).toBe("");
  });

  it("trims what somebody typed with a stray space", () => {
    expect(fieldsFor(answers({ name: "  Mulch  " })).name).toBe("Mulch");
  });

  it("defaults waste rather than sending an empty one", () => {
    expect(fieldsFor(answers({ kind: "material", wastePct: "" })).waste_factor_pct).toBe("10");
  });
});
