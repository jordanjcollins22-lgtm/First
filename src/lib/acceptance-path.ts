/**
 * What happens the moment a client accepts.
 *
 * Accepting used to be the end of the road: the status changed, an invoice
 * for the whole amount went out, and the client was looking at a thank-you.
 * Anybody who wanted to spread the cost had to ring up and ask, which meant
 * the ones who did not ring simply did not pay.
 *
 * So acceptance now leads straight into the one question left: how would you
 * like to pay for it. And the answer to that decides when the work gets
 * booked, because the two are the same decision.
 *
 * The rule the business actually runs on: a discount is a discount for money
 * up front. It survives as long as the whole amount is in before the crew
 * starts. Spreading it over payments is fine and keeps the discount, but the
 * job is booked from the last payment rather than from today. A client who
 * wants to start sooner than that can, and gives up the discount to do it.
 */

/** Whole months, because "one month from the final payment" is the rule. */
const BOOKING_MONTHS_AFTER_FINAL_PAYMENT = 1;

export type PathId =
  /** Settle the whole thing now. Keeps the discount, books straight away. */
  | "full"
  /** Spread it. Keeps the discount, books a month after the last payment. */
  | "plan"
  /** Start sooner and give up the discount. */
  | "plan_no_discount";

export interface PaymentOption {
  id: PathId;
  label: string;
  detail: string;
  /** Whether the agreed discount survives this choice. */
  keepsDiscount: boolean;
  /**
   * Whether the work waits for the money.
   *
   * True only where the discount is being protected: the discount exists
   * because the money came first, so a job that starts before the last
   * payment has had the discount without the thing it was for.
   */
  schedulesAfterFinalPayment: boolean;
}

export interface AcceptanceContext {
  /** The agreed discount in cents. Zero means there is nothing to protect. */
  discountCents: number;
  /** What is owed after the discount, in cents. */
  totalCents: number;
}

export function hasDiscount(context: AcceptanceContext): boolean {
  return context.discountCents > 0;
}

/**
 * The choices a client is offered right after accepting.
 *
 * With no discount on the proposal there is nothing to trade away, so the
 * third option is not offered. Showing somebody a choice between two
 * identical outcomes is how a form gets abandoned.
 */
/**
 * What a client is offered once they accept.
 *
 * One option: pay it. Splitting used to be offered here as two further
 * choices, and it was the wrong place to offer it — a client picking their
 * own instalment plan on a proposal page commits the business to terms
 * nobody agreed to, on a job that has not started, and the discount rules
 * around it took a paragraph to explain at the exact moment somebody had
 * already decided to buy.
 *
 * Paying over time still exists and is still used. It is set up by the
 * office, against an invoice, where somebody has agreed the terms with the
 * client first. See `plan-progress.ts` and the payment plan on an invoice.
 *
 * The "plan" and "plan_no_discount" paths are deliberately still understood
 * everywhere they are read: proposals accepted on those terms are out in the
 * world, and the ones already agreed have to keep working. They are simply
 * no longer offered.
 */
// The context is no longer consulted, and the parameter stays so every
// caller keeps working while the shape of this is still one option.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function optionsAfterAccept(_context: AcceptanceContext): PaymentOption[] {
  return [
    {
      id: "full",
      label: "Pay now",
      detail: "Card, Apple Pay or Google Pay on the next screen. We book you in from there.",
      keepsDiscount: true,
      schedulesAfterFinalPayment: false,
    },
  ];
}

export function optionById(context: AcceptanceContext, id: string): PaymentOption | undefined {
  return optionsAfterAccept(context).find((o) => o.id === id);
}

/** What is actually owed once the choice is made. */
export function amountForPath(context: AcceptanceContext, option: PaymentOption): number {
  // Giving up the discount puts it back on the bill. The stored total is
  // already net of it, so it has to be added rather than recalculated, or a
  // percentage discount gets applied to a different number than it was agreed
  // against.
  return option.keepsDiscount ? context.totalCents : context.totalCents + context.discountCents;
}

/**
 * When the crew can be booked, once the last payment lands.
 *
 * Calendar months rather than thirty days, because "one month from the final
 * payment" is what a person means and what they will hold us to. Clamped to
 * the end of a short month so a payment on the 31st of January books for the
 * 28th of February rather than sliding into March.
 */
export function bookableFrom(finalPaymentAt: Date): Date {
  const target = new Date(finalPaymentAt.getTime());
  const day = target.getUTCDate();
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + BOOKING_MONTHS_AFTER_FINAL_PAYMENT);

  const lastOfMonth = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastOfMonth));
  return target;
}

/** YYYY-MM-DD, which is what a date column wants. */
export function bookableFromKey(finalPaymentAt: Date): string {
  return bookableFrom(finalPaymentAt).toISOString().slice(0, 10);
}

/**
 * What to tell the client once they have chosen.
 *
 * Says the consequence, not the mechanism. "We will be in touch to book you
 * in" is the thing they want to know; which table a row went into is not.
 */
export function confirmationFor(option: PaymentOption): string {
  if (option.id === "full") {
    return "Thank you. That is settled, so go ahead and pick the day you would like us.";
  }
  if (option.schedulesAfterFinalPayment) {
    return (
      "Thank you. We will email your payment schedule over. Your discount is safe, and once the " +
      "final payment lands we will book you in for one month from that day."
    );
  }
  return (
    "Thank you. We will email the rest of your payment schedule over, so go ahead and pick the " +
    "day you would like us."
  );
}
