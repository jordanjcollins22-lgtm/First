import { describe, expect, it } from "vitest";

import {
  HOUSE_SLOT,
  HOUSE_SLOTS,
  SELLABLE_SLOT_COUNT,
  SLOTS,
  bookedRevenue,
  nextOpenSlot,
  openSlots,
  potentialRevenue,
  slotsForSide,
  type FlyerAd,
} from "@/lib/flyer";

function ad(slot: number, overrides: Partial<FlyerAd> = {}): FlyerAd {
  return {
    id: `ad-${slot}`,
    slot,
    businessName: "Someone",
    contact: null,
    imagePath: `art/${slot}.png`,
    price: 100,
    notes: null,
    ...overrides,
  };
}

describe("the sheet", () => {
  it("has eight squares, four to a side", () => {
    expect(SLOTS).toHaveLength(8);
    expect(slotsForSide("front")).toHaveLength(4);
    expect(slotsForSide("back")).toHaveLength(4);
  });

  it("sells six of them", () => {
    expect(SELLABLE_SLOT_COUNT).toBe(6);
  });

  it("keeps the front top-right for us", () => {
    const house = SLOTS.find((s) => s.slot === HOUSE_SLOT)!;
    expect(house.side).toBe("front");
    expect(house.row).toBe(0);
    expect(house.col).toBe(1);
    expect(house.forSale).toBe(false);
  });

  it("reads across before it reads down", () => {
    expect(SLOTS[0]).toMatchObject({ slot: 1, row: 0, col: 0 });
    expect(SLOTS[1]).toMatchObject({ slot: 2, row: 0, col: 1 });
    expect(SLOTS[2]).toMatchObject({ slot: 3, row: 1, col: 0 });
    expect(SLOTS[4]).toMatchObject({ slot: 5, side: "back", row: 0, col: 0 });
  });
});

describe("open squares", () => {
  it("counts an empty sheet as six open", () => {
    expect(openSlots([])).toHaveLength(6);
  });

  it("never offers our own square", () => {
    expect(openSlots([]).some((s) => s.slot === HOUSE_SLOT)).toBe(false);
  });

  it("treats a booking with no artwork as still open", () => {
    // A name without a picture is a conversation, not a sale.
    expect(openSlots([ad(1, { imagePath: null })])).toHaveLength(6);
  });

  it("fills the front before the back", () => {
    expect(nextOpenSlot([])!.slot).toBe(1);
    expect(nextOpenSlot([ad(1)])!.slot).toBe(3);
    const frontFull = [ad(1), ad(3), ad(4)];
    expect(nextOpenSlot(frontFull)!.slot).toBe(5);
  });

  it("returns nothing once the sheet is full", () => {
    const full = [1, 3, 4, 5, 6, 7, 8].map((slot) => ad(slot));
    expect(openSlots(full)).toEqual([]);
    expect(nextOpenSlot(full)).toBeNull();
  });
});

describe("money", () => {
  it("adds up what has been sold", () => {
    expect(bookedRevenue([ad(1, { price: 75 }), ad(3, { price: 125 })])).toBe(200);
  });

  it("does not count our own square as revenue", () => {
    expect(bookedRevenue([ad(HOUSE_SLOT, { price: 500 })])).toBe(0);
  });

  it("ignores a booking with no artwork", () => {
    expect(bookedRevenue([ad(1, { price: 75, imagePath: null })])).toBe(0);
  });

  it("prices the full sheet off what has actually been charged", () => {
    // One at 100, one at 200, average 150 across six squares.
    expect(potentialRevenue([ad(1, { price: 100 }), ad(3, { price: 200 })])).toBe(900);
  });

  it("says nothing rather than guessing when none have sold", () => {
    expect(potentialRevenue([])).toBeNull();
  });
});

describe("the squares we keep", () => {
  it("keeps the top right of both sides", () => {
    // Front carries the postage indicia. Back is where an eye lands on a page
    // nobody chose to read.
    for (const slot of HOUSE_SLOTS) {
      const position = SLOTS.find((s) => s.slot === slot)!;
      expect(position.row, `slot ${slot}`).toBe(0);
      expect(position.col, `slot ${slot}`).toBe(1);
      expect(position.forSale, `slot ${slot}`).toBe(false);
    }
  });

  it("keeps one on each side, not two on one", () => {
    const sides = HOUSE_SLOTS.map((slot) => SLOTS.find((s) => s.slot === slot)!.side);
    expect(new Set(sides).size).toBe(2);
  });

  it("never offers one of ours for sale", () => {
    for (const slot of HOUSE_SLOTS) {
      expect(openSlots([]).some((s) => s.slot === slot), `slot ${slot}`).toBe(false);
    }
  });
});
