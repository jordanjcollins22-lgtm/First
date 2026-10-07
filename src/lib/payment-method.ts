/**
 * What the payments table will accept for `method`, and how to get there from
 * whatever a processor's export calls it.
 *
 * The column is constrained to four values. An export is not: the real file
 * carries "Credit Card", "Debit Card", "Cheque", "Us Bank Account", "Prepaid
 * Card" and "Bank Transfer", none of which are among them. Writing those
 * straight through fails the check constraint on the first batch, which takes
 * down the whole import rather than the one row.
 *
 * So the export's wording is folded into the four, and the original is kept on
 * the payment's note. Narrowing "Debit Card" to 'card' loses a detail worth
 * having, and losing it silently is how somebody later wonders why every card
 * payment looks the same.
 */

export type PaymentMethod = "card" | "cash" | "check" | "other";

const CARD = /\b(credit|debit|prepaid|card|visa|mastercard|amex|american express|discover|stripe|apple pay|google pay)\b/i;
const CHECK = /\b(check|cheque|e-?check)\b/i;
const CASH = /\bcash\b/i;

/**
 * The four the column allows. Anything unrecognised — including an empty cell
 * — becomes 'other' rather than being guessed at, because a wrong method is
 * worse than an unspecific one when somebody is reconciling against a bank
 * statement.
 */
export function paymentMethod(raw: string | null | undefined): PaymentMethod {
  const text = (raw ?? "").trim();
  if (!text) return "other";

  // Card first: "Prepaid Card" and "Credit Card" both need to land on 'card'
  // before anything else gets a look at them.
  if (CARD.test(text)) return "card";
  if (CHECK.test(text)) return "check";
  if (CASH.test(text)) return "cash";
  return "other";
}

/**
 * The export's own wording, when it said something the four values do not
 * carry. Null when it added nothing — "Cash" folding to 'cash' is not worth a
 * note, "Us Bank Account" folding to 'other' is.
 */
export function methodDetail(raw: string | null | undefined): string | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  return text.toLowerCase() === paymentMethod(text) ? null : text;
}
