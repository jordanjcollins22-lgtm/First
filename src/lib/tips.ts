/**
 * Asking a client whether they would like to leave something for the crew.
 *
 * The moment to ask is when the job is finished and the garden looks the way
 * they hoped it would, which is also the one moment nobody in this business is
 * standing in front of a screen. So it is a link, handed over or sent, and the
 * page it opens has one question on it.
 *
 * Three things about tipping matter more than the arithmetic.
 *
 * The ask has to be easy to decline. A tip prompt with no way past it is a
 * toll, it reads as one, and it costs more in goodwill than it collects. "No
 * thanks" is a real answer and is on the page as a real button.
 *
 * The suggestions have to be sane for the size of the job. Fifteen percent of
 * a nine thousand dollar hardscape is thirteen hundred dollars, which is not a
 * tip, it is an insult dressed as a default -- nobody tips a percentage on a
 * job that size, and being asked to makes the whole page feel grabby. So the
 * suggestions are percentages on small jobs and flat amounts on large ones,
 * and they are always round numbers a person would actually think of.
 *
 * And it has to be clear where the money goes. A tip the client believes goes
 * to the crew, that does not, is the kind of thing that ends up in a review.
 */

/** Where the percentage suggestions stop making sense. */
const BIG_JOB_CENTS = 150_000;

/** What a tip is offered as on an ordinary job. */
const PERCENTAGES = [10, 15, 20];

/** What is offered on a job too big to tip a percentage of. */
const FLAT_CENTS = [2_000, 4_000, 6_000];

/** Below this, a suggestion says more about what we think of the crew. */
const SMALLEST_SUGGESTION_CENTS = 500;

export interface TipOption {
  cents: number;
  /** What the button says. */
  label: string;
  /** "15%" on a small job, empty on a big one where the percentage is noise. */
  note: string;
}

/**
 * What to offer, for a job of this size.
 *
 * Rounded to whole dollars, because a suggested tip of $47.83 is a number a
 * machine produced and reads like one. Duplicates are dropped: on a small
 * enough job two percentages round to the same dollar, and offering the same
 * amount twice looks broken.
 */
export function tipOptions(jobTotalCents: number): TipOption[] {
  const total = Math.max(0, Math.round(jobTotalCents));

  // Nothing to take a percentage of, and no job size to judge by. Flat
  // amounts are the only honest offer.
  if (total <= 0) {
    return FLAT_CENTS.map((cents) => ({ cents, label: dollars(cents), note: "" }));
  }

  if (total >= BIG_JOB_CENTS) {
    return FLAT_CENTS.map((cents) => ({ cents, label: dollars(cents), note: "" }));
  }

  const seen = new Set<number>();
  const options: TipOption[] = [];
  for (const percent of PERCENTAGES) {
    const cents = Math.round((total * percent) / 100 / 100) * 100;
    // A suggested tip of a dollar or two is not a suggestion, it is a
    // suggestion that the crew is worth a dollar or two.
    if (cents < SMALLEST_SUGGESTION_CENTS || seen.has(cents)) continue;
    seen.add(cents);
    options.push({ cents, label: dollars(cents), note: `${percent}%` });
  }
  // A job small enough that every percentage lands under the floor still
  // deserves an ask, and a flat five dollars is a real thing to leave.
  return options.length > 0
    ? options
    : [{ cents: SMALLEST_SUGGESTION_CENTS, label: dollars(SMALLEST_SUGGESTION_CENTS), note: "" }];
}

/** The most anybody can leave in one go, as a guard against a fat finger. */
export const MAX_TIP_CENTS = 100_000;

export type TipCheck = { ok: true; cents: number } | { ok: false; message: string };

/**
 * Whether a typed-in amount is one we should take.
 *
 * The ceiling is not a judgement about generosity. It is that a client meaning
 * to leave $40 and leaving $4,000 is a refund, an apology and a phone call,
 * and catching it here costs nothing.
 */
export function checkTipAmount(dollarsIn: string | number): TipCheck {
  const value = typeof dollarsIn === "number" ? dollarsIn : Number(String(dollarsIn).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(value)) return { ok: false, message: "That doesn't look like an amount." };

  const cents = Math.round(value * 100);
  if (cents <= 0) return { ok: false, message: "Enter an amount above zero." };
  if (cents < 100) return { ok: false, message: "Card fees would eat anything under a dollar." };
  if (cents > MAX_TIP_CENTS) {
    return { ok: false, message: `That is more than ${dollars(MAX_TIP_CENTS)}. Give us a call instead.` };
  }
  return { ok: true, cents };
}

export type TipStatus = "asked" | "unpaid" | "paid" | "declined";

export interface TipRecord {
  status: TipStatus;
  amountCents: number | null;
  paidAt: string | null;
}

/**
 * Whether there is any point showing the page.
 *
 * A tip already paid must not ask again -- a client who comes back to the link
 * to check it went through should see that it did, not a fresh request for
 * money. A declined one is different: somebody who said no and changed their
 * mind should be able to.
 */
export function stillAsking(tip: TipRecord): boolean {
  return tip.status !== "paid";
}

export interface TipTotals {
  /** Tips actually paid. */
  paid: number;
  count: number;
  /** Asked and neither paid nor declined. */
  pending: number;
  declined: number;
  /** Of the clients who answered, the share who left something. */
  rate: number;
  /** What a tip is, when one is left. */
  average: number;
}

/**
 * How the asking is going.
 *
 * The rate counts only the people who answered one way or the other. Counting
 * silence as a no would make the figure move with how many links were handed
 * out rather than with how people responded to them, which is a different
 * thing and the one already answered by the count.
 */
export function tallyTips(tips: readonly TipRecord[]): TipTotals {
  let paid = 0;
  let count = 0;
  let pending = 0;
  let declined = 0;

  for (const tip of tips) {
    if (tip.status === "paid") {
      paid += (tip.amountCents ?? 0) / 100;
      count += 1;
    } else if (tip.status === "declined") declined += 1;
    else pending += 1;
  }

  const answered = count + declined;
  return {
    paid: round(paid),
    count,
    pending,
    declined,
    rate: answered > 0 ? Math.round((count / answered) * 100) / 100 : 0,
    average: count > 0 ? round(paid / count) : 0,
  };
}

/** Whole dollars where it is whole, cents where it is not. */
export function dollars(cents: number): string {
  const value = cents / 100;
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  });
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
