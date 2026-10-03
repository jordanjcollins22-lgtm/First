/**
 * A receipt: proof that money arrived.
 *
 * The system has always known when it did. Ninety-eight payments are on file
 * and nobody outside this office can see any of them, because there was
 * nothing to hand a client afterwards. That gap costs more than it looks. A
 * client who paid cash on a driveway and got nothing back has to trust that
 * somebody wrote it down, and the one who rings in March asking what they paid
 * in November gets an answer out of somebody's memory.
 *
 * An invoice and a receipt are not the same document and conflating them is
 * the usual mistake. An invoice asks. A receipt confirms, is issued after the
 * fact, and is never a request for anything. So this says what arrived, when,
 * how, and what it was for, and it never carries a balance due or a pay
 * button, because a client looking at a receipt has already paid and being
 * asked again is alarming.
 *
 * What it says about a balance is the one judgement here. A receipt for a
 * deposit that says nothing else invites "so am I paid up?", and answering
 * that in March from memory is the problem this exists to end. So it says
 * what this payment was against and what is still outstanding, when we know,
 * and says nothing at all when we do not, rather than implying a zero.
 */

export type PaymentMethod = "cash" | "check" | "card" | "transfer" | "other";

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  check: "Check",
  card: "Card",
  transfer: "Bank transfer",
  other: "Other",
};

export interface BusinessBlock {
  phone: string | null;
  email: string | null;
  /** As it prints, line breaks kept. */
  address: string | null;
  website: string | null;
  /** A full URL or a path under /public. Null prints the name as a wordmark. */
  logoUrl: string | null;
}

/**
 * The address as lines, for printing one under the other.
 *
 * Line breaks are lines, exactly as typed. An address typed on one line is
 * split once, at its first comma: the street on top and "City, ST 21014"
 * kept together underneath, because that pair is one line by every
 * convention a client has ever seen and splitting it reads as a mistake.
 */
export function addressLines(block: Pick<BusinessBlock, "address">): string[] {
  const raw = (block.address ?? "").trim();
  if (!raw) return [];
  if (/\r?\n/.test(raw)) {
    return raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }
  const comma = raw.indexOf(",");
  if (comma === -1) return [raw];
  const street = raw.slice(0, comma).trim();
  const rest = raw.slice(comma + 1).trim();
  return [street, rest].filter(Boolean);
}

/** What the client reads. Every field is either known or left out. */
export interface Receipt {
  number: string;
  /** Money that arrived, in cents. */
  amountCents: number;
  receivedAt: string;
  method: PaymentMethod;
  /** Who paid, as we know them. */
  payerName: string | null;
  /** What it was for. The job's own name, or the property. */
  forWhat: string | null;
  address: string | null;
  businessName: string;
  /**
   * Who to ring about it. Every field optional, and the page leaves out what
   * is blank rather than printing "Phone:" beside nothing.
   */
  business: BusinessBlock;
  /** Last four of a card, a check number, whatever identifies the payment. */
  reference: string | null;
  note: string | null;
  /**
   * What is still owed on the job this payment was against.
   *
   * Null means we do not know rather than nothing. The difference matters: a
   * receipt that prints "$0 outstanding" on a job nobody has totalled has told
   * the client they are paid up, which is a thing they will hold us to.
   */
  outstandingCents: number | null;
}

/**
 * The receipt's number.
 *
 * Year first so a year's receipts sort and file together, and so the number
 * carries its own context when somebody reads one out over the phone. Padded
 * to four, which is more receipts than this business will write in a year and
 * cheap insurance against the day it is not.
 */
export function receiptNumber(year: number, sequence: number): string {
  const safeYear = Number.isFinite(year) ? Math.trunc(year) : new Date().getFullYear();
  const safeSequence = Math.max(1, Math.trunc(Number(sequence) || 1));
  return `R-${safeYear}-${String(safeSequence).padStart(4, "0")}`;
}

/** The next one in a year, from what has already been issued. */
export function nextSequence(existing: readonly string[], year: number): number {
  const prefix = `R-${year}-`;
  let highest = 0;
  for (const number of existing) {
    if (!number?.startsWith(prefix)) continue;
    const value = Number.parseInt(number.slice(prefix.length), 10);
    if (Number.isFinite(value) && value > highest) highest = value;
  }
  return highest + 1;
}

/**
 * What the receipt says at the top.
 *
 * Past tense and no ambiguity. "Payment received" is the whole message, and
 * everything under it is the detail somebody needs six months later. A
 * constant rather than a function, because it does not depend on the payment
 * and a function taking one would imply it did.
 */
export const RECEIPT_HEADLINE = "Payment received, thank you";

/**
 * The line under it: what arrived and when, in one sentence.
 */
export function receiptLine(receipt: Receipt): string {
  const amount = money(receipt.amountCents);
  const when = longDay(receipt.receivedAt);
  const how = METHOD_LABEL[receipt.method] ?? "Payment";
  return `${amount} received by ${how.toLowerCase()} on ${when}.`;
}

/**
 * What is still owed, said carefully or not at all.
 *
 * Silence when we do not know. A receipt is not the document to guess a
 * balance on: a client told they are paid up when they are not will hold us
 * to it, and one told they owe money they do not will ring about it.
 */
export function balanceLine(receipt: Receipt): string | null {
  if (receipt.outstandingCents == null) return null;
  if (receipt.outstandingCents <= 0) {
    return "That settles this job in full. Nothing further is owed.";
  }
  return `${money(receipt.outstandingCents)} remains on this job. We will send the next invoice when it is due.`;
}

/** Whether this payment can have a receipt written for it at all. */
export function canIssue(payment: { amountCents: number; receivedAt: string | null }): boolean {
  if (!Number.isFinite(payment.amountCents) || payment.amountCents <= 0) return false;
  if (!payment.receivedAt) return false;
  return !Number.isNaN(Date.parse(payment.receivedAt));
}

/** What the file is called when somebody saves it. */
export function receiptFileName(receipt: Receipt): string {
  const who = (receipt.payerName ?? "")
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return who ? `${receipt.number}-${who}.pdf` : `${receipt.number}.pdf`;
}

export function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}

/** A date a person would read aloud. */
export function longDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
