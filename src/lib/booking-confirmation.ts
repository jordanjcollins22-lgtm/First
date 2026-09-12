/**
 * What the last screen of a proposal is allowed to say.
 *
 * It used to offer the client a calendar. Two problems with that. The small
 * one is that it told somebody a job was booked when the office had not
 * looked at the crew's week yet. The large one is that the page was reachable
 * by backing out of the card sheet: the payment path was claimed the moment
 * the client picked how to pay, so closing the wallet without paying still
 * landed on a page that let them book a day for a job nobody had been paid
 * for.
 *
 * So this screen no longer books anything. It reports what has actually
 * happened, and the one outcome it will not report is a booking that has not
 * been paid for — that goes back to the payment screen, which is where the
 * client was when they walked away.
 */

export type ConfirmationKind =
  /** Not accepted yet. Nothing to confirm. */
  | "not_accepted"
  /** Accepted, money still outstanding. Back to the payment screen. */
  | "unpaid"
  /** Paid. A team member picks it up from here. */
  | "processed"
  /** On a plan that protects a discount, so booking waits for the payoff. */
  | "after_payoff"
  /** No card taken on this site, so an invoice is going out instead. */
  | "invoiced";

export interface ConfirmationInput {
  status: string;
  /** Which way they chose to pay. Null until they choose. */
  paymentPath: string | null;
  /** Set once the money is actually in. */
  paidAt: string | null;
  /** Their plan holds the discount, so the crew is booked after the payoff. */
  schedulesAfterFinalPayment: boolean;
  /** Whether this site can take a card at all. False means we invoice. */
  canCharge: boolean;
}

export interface Confirmation {
  kind: ConfirmationKind;
  /** Where to send them instead, when this screen has nothing to say. */
  redirectTo: "proposal" | "pay" | null;
  heading: string;
  body: string;
}

const REACH_OUT = "A team member will reach out and get your service booked in as soon as possible.";

export function confirmationFor(input: ConfirmationInput): Confirmation {
  if (input.status !== "accepted") {
    return { kind: "not_accepted", redirectTo: "proposal", heading: "", body: "" };
  }

  if (input.paidAt) {
    if (input.schedulesAfterFinalPayment) {
      return {
        kind: "after_payoff",
        redirectTo: null,
        heading: "Your booking is processed.",
        body:
          "Your discount is safe. We will email your payment schedule, and a team member will " +
          "reach out to get your service booked in for one month after your final payment.",
      };
    }
    return {
      kind: "processed",
      redirectTo: null,
      heading: "Your booking is processed.",
      body: `We have just processed your booking. ${REACH_OUT}`,
    };
  }

  // No card taken on this site: the money comes by invoice, so there is
  // nothing for them to have walked away from and the job is real.
  if (input.paymentPath && !input.canCharge) {
    return {
      kind: "invoiced",
      redirectTo: null,
      heading: "We have your acceptance.",
      body: `Your invoice is on its way by email. ${REACH_OUT}`,
    };
  }

  // Accepted, chose a way to pay, and no money arrived. That is somebody who
  // closed the card sheet, and the honest place for them is back at it.
  return { kind: "unpaid", redirectTo: "pay", heading: "", body: "" };
}

/** Whether this screen shows anything at all, rather than sending them on. */
export function showsConfirmation(confirmation: Confirmation): boolean {
  return confirmation.redirectTo === null;
}
