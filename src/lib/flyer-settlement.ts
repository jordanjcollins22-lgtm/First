/**
 * Finding out that somebody paid, without being told.
 *
 * Stripe knows perfectly well who has paid. What it does not do on its own
 * is tell this app, and a booking that stays "approved" forever is one the
 * office chases for money it already has.
 *
 * A webhook is Stripe pushing that news. The alternative is asking, which
 * needs nothing set up at all: every checkout we open is recorded against
 * the booking, so any time somebody looks at that booking or at the run it
 * belongs to, the sessions still outstanding can be read back from Stripe
 * and settled.
 *
 * Asking is slower than being told, and that is the whole of the difference.
 * A webhook settles a booking within a second; asking settles it the next
 * time anybody looks. For seven adverts on a flyer that is the same thing.
 */

/** What Stripe says about a checkout we opened. */
export interface SessionState {
  /** Stripe's own payment_status. */
  paymentStatus: string | null;
  /** Stripe's own status: open, complete, expired. */
  status: string | null;
}

export type Settlement =
  /** Money is in. Mark it paid and give it a square. */
  | "settle"
  /** Nothing has happened yet. Leave it alone and look again later. */
  | "wait"
  /** They walked away and the link has died. Nothing owed, nothing held. */
  | "expired";

/**
 * What to do about one outstanding checkout.
 *
 * Deliberately conservative: anything that is not clearly paid is left
 * alone. Marking a booking paid on a maybe is how somebody ends up on a
 * flyer they never bought.
 */
export function settlementFor(session: SessionState): Settlement {
  if (session.paymentStatus === "paid" || session.paymentStatus === "no_payment_required") {
    return "settle";
  }
  if (session.status === "expired") return "expired";
  return "wait";
}

/** Bookings worth asking Stripe about. */
export function needsChecking<T extends { status: string; checkoutSessionId: string | null }>(
  bookings: T[]
): T[] {
  return bookings.filter(
    (b) => Boolean(b.checkoutSessionId) && b.status !== "paid" && b.status !== "placed" && b.status !== "refunded"
  );
}

/**
 * How many to ask about in one go.
 *
 * Each one is a round trip to Stripe on somebody's page load. A run holds
 * seven adverts, so this is generous; the cap exists so a runaway list can
 * never turn a page into a minute of waiting.
 */
export const MAX_CHECKS_PER_LOAD = 10;
