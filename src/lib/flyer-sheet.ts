/**
 * What one run's sheet actually looks like.
 *
 * Two things fill the eight squares and they are not the same kind of thing.
 *
 * The standing flyer is the template: our own advert, and any regular whose
 * square is simply always theirs. It is what a new run starts as, so a run
 * nobody has sold anything into still prints something sensible.
 *
 * A booking is one advertiser on one run. It overrides the template for that
 * square, because somebody who paid for this run beats a square that has
 * always sat there, and it stops overriding when the run is over.
 *
 * Composed rather than stored. A "sheet" table would be a third copy of the
 * same facts and would start lying the moment somebody moved an advert.
 */

import { HOUSE_SLOTS, SLOTS, type FlyerAd, type Side } from "@/lib/flyer";

export type SquareSource = "house" | "template" | "booking" | "open";

export interface SheetSquare {
  slot: number;
  side: Side;
  row: 0 | 1;
  col: 0 | 1;
  source: SquareSource;
  /** Who is in it. Null for an open square. */
  businessName: string | null;
  imageUrl: string | null;
  /** Set only where a booking fills it, so the office can open the booking. */
  bookingId: string | null;
  /** Never sellable. Ours, and where the postage indicia sits. */
  isHouse: boolean;
}

export interface SheetBooking {
  id: string;
  slot: number | null;
  businessName: string;
  imageUrl: string | null;
  status: string;
}

/**
 * Bookings that hold a square. A draft nobody has paid for does not, or a
 * run sells six spots and prints four.
 */
export function holdsASquare(booking: SheetBooking): boolean {
  return booking.slot != null && (booking.status === "paid" || booking.status === "placed");
}

export function composeSheet(input: {
  /** The standing flyer, keyed by slot. */
  template: FlyerAd[];
  bookings: SheetBooking[];
  /** Turns a stored path into something an img can load. */
  imageUrlFor: (path: string) => string;
}): SheetSquare[] {
  const templateBySlot = new Map(input.template.map((ad) => [ad.slot, ad]));
  const bookingBySlot = new Map(
    input.bookings.filter(holdsASquare).map((b) => [b.slot as number, b])
  );

  return SLOTS.map((position) => {
    const isHouse = HOUSE_SLOTS.includes(position.slot);
    const booking = bookingBySlot.get(position.slot);
    const templated = templateBySlot.get(position.slot);

    // A booking wins: somebody paid for this run, and the template is what
    // the square looks like when nobody has.
    if (booking) {
      return {
        ...position,
        source: "booking" as const,
        businessName: booking.businessName,
        imageUrl: booking.imageUrl,
        bookingId: booking.id,
        isHouse,
      };
    }

    if (templated?.imagePath) {
      return {
        ...position,
        source: isHouse ? ("house" as const) : ("template" as const),
        businessName: templated.businessName,
        imageUrl: input.imageUrlFor(templated.imagePath),
        bookingId: null,
        isHouse,
      };
    }

    return {
      ...position,
      source: isHouse ? ("house" as const) : ("open" as const),
      businessName: templated?.businessName ?? null,
      imageUrl: null,
      bookingId: null,
      isHouse,
    };
  });
}

export function squaresForSide(squares: SheetSquare[], side: Side): SheetSquare[] {
  return squares.filter((s) => s.side === side);
}

/** Squares somebody could still be put into. */
export function openSquares(squares: SheetSquare[]): SheetSquare[] {
  return squares.filter((s) => !s.isHouse && s.source !== "booking");
}

/**
 * Bookings on this run with nowhere to sit.
 *
 * Somebody paid and then every square filled up, or an advert was moved out
 * of one and never put back. Either way it is the office's problem to see,
 * not the advertiser's to discover on the doormat.
 */
export function unplacedBookings(bookings: SheetBooking[]): SheetBooking[] {
  return bookings.filter(
    (b) => b.slot == null && (b.status === "paid" || b.status === "placed")
  );
}

/** One line for the top of a run's sheet. */
export function sheetSummary(squares: SheetSquare[]): string {
  const sold = squares.filter((s) => s.source === "booking").length;
  const open = openSquares(squares).filter((s) => s.source === "open").length;
  if (open === 0) return `${sold} sold, sheet full.`;
  return `${sold} sold, ${open} square${open === 1 ? "" : "s"} still empty.`;
}
