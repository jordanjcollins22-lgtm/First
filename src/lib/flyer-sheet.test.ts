import { describe, expect, it } from "vitest";

import { HOUSE_SLOT } from "@/lib/flyer";
import type { FlyerAd } from "@/lib/flyer";
import {
  composeSheet,
  holdsASquare,
  openSquares,
  sheetSummary,
  squaresForSide,
  unplacedBookings,
  type SheetBooking,
} from "./flyer-sheet";

const url = (path: string) => `https://cdn.example.com/${path}`;

function templateAd(slot: number, over: Partial<FlyerAd> = {}): FlyerAd {
  return {
    id: `t${slot}`,
    slot,
    businessName: `Regular ${slot}`,
    contact: null,
    imagePath: `template/${slot}.png`,
    price: null,
    notes: null,
    ...over,
  };
}

function booking(over: Partial<SheetBooking> = {}): SheetBooking {
  return {
    id: "b1",
    slot: 1,
    businessName: "Bel Air Bakery",
    imageUrl: "https://cdn.example.com/bakery.png",
    status: "placed",
    ...over,
  };
}

const sheet = (template: FlyerAd[] = [], bookings: SheetBooking[] = []) =>
  composeSheet({ template, bookings, imageUrlFor: url });

describe("composeSheet", () => {
  it("always describes all eight squares", () => {
    expect(sheet()).toHaveLength(8);
    expect(sheet().map((s) => s.slot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("marks our square as ours whether or not artwork is in it", () => {
    expect(sheet().find((s) => s.slot === HOUSE_SLOT)!.source).toBe("house");
    const withArt = sheet([templateAd(HOUSE_SLOT)]);
    expect(withArt.find((s) => s.slot === HOUSE_SLOT)!.source).toBe("house");
  });

  it("fills a square from the standing flyer when nobody has bought it", () => {
    // The template is what a new run starts as, so a run nobody has sold
    // into still prints something sensible.
    const square = sheet([templateAd(3)]).find((s) => s.slot === 3)!;
    expect(square.source).toBe("template");
    expect(square.businessName).toBe("Regular 3");
    expect(square.imageUrl).toBe(url("template/3.png"));
  });

  it("lets a booking beat the standing flyer", () => {
    // Somebody who paid for this run beats a square that has always sat
    // there, and stops beating it when the run is over.
    const square = sheet([templateAd(1)], [booking({ slot: 1 })]).find((s) => s.slot === 1)!;
    expect(square.source).toBe("booking");
    expect(square.businessName).toBe("Bel Air Bakery");
    expect(square.bookingId).toBe("b1");
  });

  it("leaves a square open when nothing fills it", () => {
    const square = sheet().find((s) => s.slot === 4)!;
    expect(square.source).toBe("open");
    expect(square.imageUrl).toBeNull();
  });

  it("treats a template row with no artwork as still open", () => {
    // A row somebody typed a name into is not a printed advert.
    const square = sheet([templateAd(3, { imagePath: null })]).find((s) => s.slot === 3)!;
    expect(square.source).toBe("open");
  });
});

describe("holdsASquare", () => {
  it("is true once the money is in", () => {
    expect(holdsASquare(booking({ status: "paid" }))).toBe(true);
    expect(holdsASquare(booking({ status: "placed" }))).toBe(true);
  });

  it("is false for anybody who has not paid", () => {
    // Otherwise a run sells six spots and prints four.
    expect(holdsASquare(booking({ status: "draft" }))).toBe(false);
    expect(holdsASquare(booking({ status: "approved" }))).toBe(false);
    expect(holdsASquare(booking({ status: "refunded" }))).toBe(false);
  });

  it("is false for a paid booking with no square yet", () => {
    expect(holdsASquare(booking({ slot: null, status: "paid" }))).toBe(false);
  });
});

describe("an unpaid booking never takes a square", () => {
  it("leaves the square open for somebody who will pay", () => {
    const square = sheet([], [booking({ slot: 4, status: "approved" })]).find((s) => s.slot === 4)!;
    expect(square.source).toBe("open");
  });
});

describe("squaresForSide", () => {
  it("splits four and four", () => {
    expect(squaresForSide(sheet(), "front")).toHaveLength(4);
    expect(squaresForSide(sheet(), "back")).toHaveLength(4);
  });

  it("puts our square on the front, where the postage goes", () => {
    expect(squaresForSide(sheet(), "front").some((s) => s.isHouse)).toBe(true);
    expect(squaresForSide(sheet(), "back").some((s) => s.isHouse)).toBe(false);
  });
});

describe("openSquares", () => {
  it("never offers ours", () => {
    expect(openSquares(sheet()).some((s) => s.isHouse)).toBe(false);
  });

  it("offers a square the standing flyer fills, since a payer outranks it", () => {
    expect(openSquares(sheet([templateAd(3)])).some((s) => s.slot === 3)).toBe(true);
  });

  it("does not offer one somebody has paid for", () => {
    expect(openSquares(sheet([], [booking({ slot: 3 })])).some((s) => s.slot === 3)).toBe(false);
  });
});

describe("unplacedBookings", () => {
  it("finds somebody who paid and has nowhere to sit", () => {
    // The office's problem to see, not the advertiser's to discover on the
    // doormat.
    const lost = unplacedBookings([booking({ slot: null, status: "paid" })]);
    expect(lost).toHaveLength(1);
  });

  it("says nothing about a booking that has a square", () => {
    expect(unplacedBookings([booking({ slot: 2 })])).toEqual([]);
  });

  it("says nothing about somebody who has not paid", () => {
    expect(unplacedBookings([booking({ slot: null, status: "draft" })])).toEqual([]);
  });
});

describe("sheetSummary", () => {
  it("counts what is sold against what is still empty", () => {
    expect(sheetSummary(sheet())).toBe("0 sold, 7 squares still empty.");
    expect(sheetSummary(sheet([], [booking({ slot: 1 })]))).toBe("1 sold, 6 squares still empty.");
  });

  it("reads naturally for one", () => {
    const template = [3, 4, 5, 6, 7, 8].map((slot) => templateAd(slot));
    expect(sheetSummary(sheet(template))).toBe("0 sold, 1 square still empty.");
  });

  it("says so when there is nowhere left", () => {
    const template = [1, 3, 4, 5, 6, 7, 8].map((slot) => templateAd(slot));
    expect(sheetSummary(sheet(template))).toBe("0 sold, sheet full.");
  });

  it("uses no dashes", () => {
    expect(sheetSummary(sheet())).not.toMatch(/[—–]/);
  });
});
