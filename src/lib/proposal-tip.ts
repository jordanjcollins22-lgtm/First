/**
 * A tip added on the way through paying, on the same card payment.
 *
 * The client who is happy with the work is most likely to say so at the
 * moment they settle up, and a separate thank-you link a day later is a
 * second thing to open. So the pay page offers it there, beside the amount,
 * and the tip rides on the one card payment.
 *
 * Kept apart from the job's money everywhere it lands: the payment carries
 * the tip in its metadata, and the tip is recorded on the job's tip row, so
 * it is never counted as the price of the work.
 */

/** The shares offered, as fractions of the amount being paid. */
export const TIP_SHARES = [0.1, 0.15, 0.2] as const;

/** No more than the amount itself, and never more than $2,000 on one payment. */
const TIP_CEILING_CENTS = 200_000;

export interface TipChoice {
  /** "10%", or "No tip". */
  label: string;
  cents: number;
}

/** No tip, then each share of the amount, rounded to whole dollars. */
export function tipChoices(amountCents: number): TipChoice[] {
  const base = Math.max(0, Math.round(amountCents));
  return [
    { label: "No tip", cents: 0 },
    ...TIP_SHARES.map((share) => ({
      label: `${Math.round(share * 100)}%`,
      cents: Math.max(100, Math.round((base * share) / 100) * 100),
    })),
  ];
}

/**
 * The tip a payment may carry: a whole number of cents, never negative, never
 * more than the amount being paid or the ceiling. Anything else is no tip,
 * rather than an error that stops somebody paying their bill.
 */
export function allowedTip(tipCents: unknown, amountCents: number): number {
  const tip = typeof tipCents === "number" && Number.isFinite(tipCents) ? Math.round(tipCents) : 0;
  if (tip <= 0) return 0;
  return Math.min(tip, Math.max(0, Math.round(amountCents)), TIP_CEILING_CENTS);
}

/** The tip a payment carried, read back from its metadata. */
export function tipFromMetadata(metadata: Record<string, string> | null | undefined): number {
  const raw = Number(metadata?.tip_cents ?? 0);
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 0;
}

/** What someone typed as a tip, in dollars, as cents; null when it is not a number. */
export function typedTipCents(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, "");
  if (!cleaned) return 0;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}
