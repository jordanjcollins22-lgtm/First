/**
 * What it costs to be paid, by card and by bank.
 *
 * Stripe's US pricing: cards 2.9% + 30¢, ACH Direct Debit 0.8% capped at
 * $5 (stripe.com/pricing). A $2,000 HOA invoice costs $5 by ACH and about
 * $58 by card, which is why recurring and commercial clients are steered to
 * the bank. All in cents, rounded to a whole cent like Stripe rounds.
 */
export const ACH_RATE = 0.008;
export const ACH_CAP_CENTS = 500;
export const CARD_RATE = 0.029;
export const CARD_FIXED_CENTS = 30;

export function achFeeCents(amountCents: number): number {
  if (!(amountCents > 0)) return 0;
  return Math.min(Math.round(amountCents * ACH_RATE), ACH_CAP_CENTS);
}

export function cardFeeCents(amountCents: number): number {
  if (!(amountCents > 0)) return 0;
  return Math.round(amountCents * CARD_RATE) + CARD_FIXED_CENTS;
}

/** What paying by bank instead of card saves on one payment. */
export function achSavingsCents(amountCents: number): number {
  return Math.max(0, cardFeeCents(amountCents) - achFeeCents(amountCents));
}

export function dollars(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}
