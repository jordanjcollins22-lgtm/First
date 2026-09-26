/**
 * What goes out every month whether anybody works or not.
 *
 * The overhead figures this business prices against were typed in by hand and
 * are round numbers: rent 2,700, insurance 300, utilities 650. They are
 * somebody's memory of a bill. Meanwhile six months of real card and bank
 * transactions have been sitting in a table nobody reads, and they know the
 * actual answer to the pound.
 *
 * Two different things come out of those transactions and they are worth
 * separating, because what you do about them differs.
 *
 * A subscription is the same charge on the same day for the same amount, and
 * the question it raises is "do we still use this". A monthly obligation is
 * the insurance, the phone bill, the utility: it moves a bit, it is not
 * optional, and the question it raises is "what does this actually average".
 * Lumping them together produces a number that is neither a bill to pay nor a
 * list to cancel.
 *
 * Everything here is derived, never stored. A charge that stopped three months
 * ago drops off by itself, which a saved list would not do -- and a saved list
 * of subscriptions that is quietly out of date is worse than no list, because
 * it gets trusted.
 */

export interface Txn {
  id: string;
  /** The merchant if the bank gave one, otherwise the raw description. */
  who: string;
  /** Positive is money leaving. */
  amount: number;
  /** ISO day. */
  postedOn: string;
  accountId: string | null;
  /**
   * What the bank called it. Worth more than any guess made from the name:
   * the bank knows a restaurant from a utility and this module does not.
   */
  category: string | null;
}

export type Cadence = "weekly" | "fortnightly" | "monthly" | "quarterly" | "yearly";

export const CADENCE_LABEL: Record<Cadence, string> = {
  weekly: "Weekly",
  fortnightly: "Every two weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

/** How many of these fall in a year, for turning any of them into a monthly figure. */
const PER_YEAR: Record<Cadence, number> = {
  weekly: 52,
  fortnightly: 26,
  monthly: 12,
  quarterly: 4,
  yearly: 1,
};

/** The gap each cadence implies, in days, and how far off it may be. */
const CADENCE_DAYS: { cadence: Cadence; days: number; slack: number }[] = [
  { cadence: "weekly", days: 7, slack: 2 },
  { cadence: "fortnightly", days: 14, slack: 3 },
  { cadence: "monthly", days: 30.4, slack: 6 },
  { cadence: "quarterly", days: 91, slack: 12 },
  { cadence: "yearly", days: 365, slack: 30 },
];

export type ChargeKind =
  /** Same amount, same rhythm. The list to go through and cancel from. */
  | "subscription"
  /** Recurring but the amount moves: insurance, utilities, a phone bill. */
  | "obligation"
  /** Money moving between our own accounts, or a card being paid off. */
  | "transfer";

export const KIND_LABEL: Record<ChargeKind, string> = {
  subscription: "Subscription",
  obligation: "Monthly obligation",
  transfer: "Payment or transfer",
};

export interface RecurringCharge {
  /** Stable across runs, so a decision about it sticks. */
  key: string;
  label: string;
  kind: ChargeKind;
  cadence: Cadence;
  /** What it usually costs. The median, so one odd month does not move it. */
  typicalAmount: number;
  /** The same expressed per month, so a yearly renewal can be added up with the rest. */
  monthlyAmount: number;
  /** How much it moves, as a share of the typical amount. */
  variation: number;
  /**
   * The amount swings, and it is only recurring because the rhythm is.
   *
   * Rent and utilities. Worth saying so beside the number, because the monthly
   * figure is an average of something that was 131 one month and 2,790 the
   * next, and treating that as a fixed bill is how a forecast goes wrong.
   */
  variableAmount: boolean;
  /** How many times it has been seen. */
  hits: number;
  firstSeen: string;
  lastSeen: string;
  /** Which day of the month it usually lands on. Null on anything not monthly. */
  dayOfMonth: number | null;
  /** 0-1. How sure the pattern is, from how regular it is and how long it has run. */
  confidence: number;
  accountId: string | null;
  transactionIds: string[];
}

/**
 * A merchant name that survives the bank's formatting.
 *
 * Banks append reference numbers, store numbers, dates and their own codes, so
 * the same subscription arrives under six spellings and never looks recurring.
 * Stripping those is the difference between finding a pattern and not.
 *
 * Getting it wrong is not a small error either way. The rent arrived four
 * times in six months and three of them read "RECURRING" while the fourth read
 * "POS PUR" -- so the largest cost in the business split into two charges, one
 * of which was too thin to detect. The apartment arrived twice under a
 * reference code that mixed letters and digits, which the digit-stripping
 * missed, and never looked recurring at all. Both were real money that the
 * overhead simply did not know about.
 */
export function merchantKey(name: string): string {
  return (
    name
      .toLowerCase()
      // Reference and card numbers, which are the usual culprits.
      .replace(/\b[a-z]*\d{4,}[a-z]*\b/g, " ")
      .replace(/\bx{2,}\d*\b/g, " ")
      // Anything mixing letters and digits in one word is a reference the bank
      // made up: "7YMM6G", "ST-B5X0T8D1U9E7", "A2266". Has to happen while the
      // digits are still there -- strip them first and "7YMM6G" survives as
      // "ymm g", which is how one bill became two merchants.
      .replace(/\b(?=[a-z]*\d)(?=\d*[a-z])[a-z\d]+\b/g, " ")
      .replace(/[^a-z ]+/g, " ")
      .replace(
        /\b(?:payment|paymentrec|bill ?pay|billpay|autopay|recurring|purchase|pur|pos|xfer|misc|ach|des|id|indn|ppd|web|tel|pmt|pmts|epayment)\b/g,
        " "
      )
      // A leading article is not part of a name: "The Home Depot" and "Home
      // Depot" are one shop and were two.
      .replace(/^\s*the\b/, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60) || "unknown"
  );
}

/**
 * Categories where people simply shop.
 *
 * A restaurant visited every other Friday looks exactly like a bill if you
 * only measure rhythm and amount, and calling it one is the mistake that makes
 * the whole list look wrong. So these have to clear a higher bar: the charge
 * must be identical to the penny, which is a machine billing us rather than
 * somebody deciding what to order.
 */
const BROWSING_CATEGORIES = new Set([
  "FOOD_AND_DRINK",
  "GENERAL_MERCHANDISE",
  "HOME_IMPROVEMENT",
  "TRANSPORTATION",
  "MEDICAL",
  "PERSONAL_CARE",
  "TRAVEL",
]);

/** What the bank already knows is money moving rather than money spent. */
const TRANSFER_CATEGORIES = new Set(["TRANSFER_OUT", "TRANSFER_IN", "LOAN_PAYMENTS"]);

/**
 * Bills the bank files as transfers, which they are not.
 *
 * A vehicle lease leaves by direct debit and gets categorised the same way as
 * moving money between our own accounts. It is not: it is a monthly obligation
 * and dropping it understates the overhead by the price of a truck.
 */
const OBLIGATION_WORDS = /\b(?:lease|mortgage|rent|insurance|premium|utilit)/i;

/**
 * Money moving inside the business rather than out of it.
 *
 * A card being paid off is not a subscription and not an overhead: it is the
 * same money counted twice, once when it was spent and again when the card was
 * settled. Counting it in a monthly total would roughly double the answer.
 */
export function looksLikeTransfer(name: string): boolean {
  return /\b(?:e-?payment|payment thank you|autopay|zelle|transfer|trnsfr|xfer|cash app|online banking|card payment|discover|applecard|capital one|chase card|amex payment)\b/i.test(
    name
  );
}

/**
 * Whether it lands on the same few days of the month every time.
 *
 * The signal that catches a bill whose amount is meaningless. A landlord takes
 * the rent on the first whether it is 131 or 2,790; a shop visited five times
 * is scattered across the month. Four days of spread is the allowance, which
 * covers a weekend and a bank holiday.
 */
function sameDayEachMonth(ordered: readonly Txn[]): boolean {
  const days = ordered.map((txn) => Number(txn.postedOn.slice(8, 10)));
  const middle = median(days);
  // Wrapped: the 1st and the 30th are a day apart on a calendar.
  const spread = days.map((day) => {
    const off = Math.abs(day - middle);
    return Math.min(off, 31 - off);
  });
  return median(spread) <= 4;
}

/** The middle value, which one freak month cannot drag around. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(b) - Date.parse(a)) / 86_400_000;
}

/** The cadence whose rhythm best matches the gaps, or null when none does. */
function cadenceFor(gaps: number[]): Cadence | null {
  if (gaps.length === 0) return null;
  const typical = median(gaps);
  let best: { cadence: Cadence; off: number } | null = null;
  for (const candidate of CADENCE_DAYS) {
    const off = Math.abs(typical - candidate.days);
    if (off > candidate.slack) continue;
    if (!best || off < best.off) best = { cadence: candidate.cadence, off };
  }
  return best?.cadence ?? null;
}

/** Any amount, as what it costs per month. */
export function monthlyEquivalent(amount: number, cadence: Cadence): number {
  return Math.round(((amount * PER_YEAR[cadence]) / 12) * 100) / 100;
}

/**
 * Which amount a charge is worth.
 *
 * The median by default, so one odd month does not move it. That is right for
 * a bill that wobbles around a level and wrong for one that stepped up: the
 * rent here ran at 2,298 and then went to 2,791, and the median of the two
 * levels is a figure the business has never actually paid and never will.
 *
 * Which of the two it is cannot be worked out from the numbers -- a step up
 * and a run of expensive months look identical until the next one arrives --
 * so it is a choice somebody makes while looking at the history.
 */
export type AmountBasis = "median" | "latest";

/**
 * The charge restated on its most recent amount.
 *
 * Everything else about it stands: the rhythm, the confidence and the history
 * are all still true. Only what it is expected to cost from here changes.
 */
export function onLatestAmount(charge: RecurringCharge, latest: number): RecurringCharge {
  if (!Number.isFinite(latest) || latest <= 0) return charge;
  return {
    ...charge,
    typicalAmount: Math.round(latest * 100) / 100,
    monthlyAmount: monthlyEquivalent(latest, charge.cadence),
    // It no longer varies around an average -- it is the last known price.
    variableAmount: false,
  };
}

/**
 * Below this much wobble it is the same charge every time, which is what a
 * subscription is. Not zero: a card fee that crosses a tax boundary, or a
 * price rise halfway through, should not stop it being a subscription.
 */
const SUBSCRIPTION_VARIATION = 0.06;
/** Above this it is not a recurring bill, it is a shop somebody visits often. */
const OBLIGATION_VARIATION = 0.45;
/** Fewer than this and a pattern is a coincidence. */
const MIN_HITS = 3;

export interface DetectOptions {
  /** Two occurrences is enough when the amount is identical to the penny. */
  minHits?: number;
}

/**
 * Everything that looks like it comes back.
 *
 * Deliberately cautious in one direction. A real subscription missed off the
 * list costs somebody a few minutes finding it by hand; a shop they visit
 * every week listed as a subscription makes the whole list look wrong, and a
 * list that looks wrong does not get used twice.
 */
export function detectRecurring(txns: readonly Txn[], today = new Date()): RecurringCharge[] {
  const groups = new Map<string, Txn[]>();
  for (const txn of txns) {
    if (txn.amount <= 0) continue;
    const key = merchantKey(txn.who);
    const list = groups.get(key) ?? [];
    list.push(txn);
    groups.set(key, list);
  }

  const found: RecurringCharge[] = [];

  for (const [key, group] of groups) {
    const ordered = [...group].sort((a, b) => a.postedOn.localeCompare(b.postedOn));
    const amounts = ordered.map((txn) => txn.amount);
    const typical = median(amounts);
    if (typical <= 0) continue;

    const variation =
      amounts.length < 2
        ? 0
        : Math.abs(
            Math.sqrt(
              amounts.reduce((sum, value) => sum + (value - typical) ** 2, 0) / amounts.length
            ) / typical
          );

    const gaps: number[] = [];
    for (let i = 1; i < ordered.length; i += 1) {
      gaps.push(daysBetween(ordered[i - 1].postedOn, ordered[i].postedOn));
    }
    const cadence = cadenceFor(gaps);
    if (!cadence) continue;

    // Two is enough only when every charge is identical to the penny, which is
    // a machine billing us rather than a person spending.
    const identical = variation < 0.005;
    if (ordered.length < (identical ? 2 : MIN_HITS)) continue;

    // The rent and the gas bill swing wildly and are the two biggest things on
    // the list. What makes them recurring is the rhythm, not the amount: the
    // same landlord on the first of the month, every month. Judging them on
    // steadiness of amount threw out the largest overhead in the business.
    const onTheClock = cadence === "monthly" && ordered.length >= 4 && sameDayEachMonth(ordered);
    if (variation > OBLIGATION_VARIATION && !onTheClock) continue;

    const categories = new Set(
      ordered.map((txn) => (txn.category ?? "").toUpperCase()).filter(Boolean)
    );
    const browsing = Array.from(categories).some((c) => BROWSING_CATEGORIES.has(c));

    // A shop, and the charge is not identical every time. That is a habit, not
    // a bill, and listing it as one is how the list loses its reader.
    if (browsing && !identical) continue;

    const namesABill = ordered.some((txn) => OBLIGATION_WORDS.test(txn.who));
    const transfer =
      !namesABill &&
      (Array.from(categories).some((c) => TRANSFER_CATEGORIES.has(c)) ||
        ordered.some((txn) => looksLikeTransfer(txn.who)));
    const kind: ChargeKind = transfer
      ? "transfer"
      : variation <= SUBSCRIPTION_VARIATION
        ? "subscription"
        : "obligation";

    const days = ordered.map((txn) => Number(txn.postedOn.slice(8, 10)));
    const dayOfMonth = cadence === "monthly" ? Math.round(median(days)) : null;

    found.push({
      key,
      label: tidyLabel(ordered[ordered.length - 1].who),
      kind,
      cadence,
      typicalAmount: Math.round(typical * 100) / 100,
      monthlyAmount: monthlyEquivalent(typical, cadence),
      variation: Math.round(variation * 1000) / 1000,
      variableAmount: variation > SUBSCRIPTION_VARIATION,
      hits: ordered.length,
      firstSeen: ordered[0].postedOn,
      lastSeen: ordered[ordered.length - 1].postedOn,
      dayOfMonth,
      confidence: confidenceOf(ordered.length, variation, gaps, cadence, ordered[ordered.length - 1].postedOn, today),
      accountId: ordered[ordered.length - 1].accountId,
      transactionIds: ordered.map((txn) => txn.id),
    });
  }

  // Biggest monthly cost first. This list is read to find money, and the
  // money is at the top.
  return found.sort((a, b) => b.monthlyAmount - a.monthlyAmount || a.label.localeCompare(b.label));
}

/**
 * The merchant as somebody would say it.
 *
 * Bank descriptions carry the terminal number, the date, the time, the
 * merchant category code and a reference, and the actual name is somewhere in
 * the middle. A list of those is unreadable, and a list nobody can read does
 * not get acted on.
 */
export function tidyLabel(name: string): string {
  const cleaned = name
    // A leading terminal number.
    .replace(/^\s*\d{3,6}\s+/, "")
    .replace(/\b(?:RECURRING|POS PUR|POS PURCHASE|PURCHASE|MISC XFER|INTERNET XFER)\b/gi, " ")
    // Dates and times the terminal stamped on.
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, " ")
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, " ")
    // Reference codes: letters and digits mixed, which a merchant name never
    // is. Checked for a digit on purpose, so HIGHLEVEL and GOHIGHLEVEL keep
    // their names while ECJBW1QY loses its.
    .replace(/\b(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{5,}\b/g, " ")
    .replace(/~\S*/g, " ")
    // Anything numeric left over, which at this point is a fragment of a code.
    .replace(/\b\d+\b/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned || name.trim();
}

/**
 * How sure we are, from four things that can each be checked.
 *
 * Length of run, steadiness of amount, steadiness of rhythm, and whether it
 * has happened recently. The last one matters most for the list being useful:
 * a subscription last charged in April is either cancelled or about to be a
 * surprise, and either way it should not sit at the top looking current.
 */
function confidenceOf(
  hits: number,
  variation: number,
  gaps: number[],
  cadence: Cadence,
  lastSeen: string,
  today: Date
): number {
  const runs = Math.min(1, (hits - 1) / 5);
  const steadyAmount = Math.max(0, 1 - variation / OBLIGATION_VARIATION);

  const expected = CADENCE_DAYS.find((entry) => entry.cadence === cadence)!;
  const drift = gaps.length === 0 ? 1 : median(gaps.map((gap) => Math.abs(gap - expected.days)));
  const steadyRhythm = Math.max(0, 1 - drift / expected.slack);

  const sinceLast = daysBetween(lastSeen, today.toISOString().slice(0, 10));
  const current = sinceLast <= expected.days * 2 ? 1 : Math.max(0, 1 - (sinceLast - expected.days * 2) / 180);

  return Math.round((runs * 0.25 + steadyAmount * 0.25 + steadyRhythm * 0.25 + current * 0.25) * 100) / 100;
}

/** Whether it has been charged recently enough to still count as live. */
export function isLive(charge: RecurringCharge, today = new Date()): boolean {
  const expected = CADENCE_DAYS.find((entry) => entry.cadence === charge.cadence)!;
  return daysBetween(charge.lastSeen, today.toISOString().slice(0, 10)) <= expected.days * 2;
}

/** When the next one is due, from the last one and the rhythm. */
export function nextDueOn(charge: RecurringCharge): string {
  const expected = CADENCE_DAYS.find((entry) => entry.cadence === charge.cadence)!;
  const next = new Date(Date.parse(charge.lastSeen) + expected.days * 86_400_000);
  return next.toISOString().slice(0, 10);
}

export interface MonthlyTotals {
  subscriptions: number;
  obligations: number;
  /** The two together. What leaves whether anybody works or not. */
  total: number;
  /** Counted separately and never in the total: the same money twice. */
  transfers: number;
}

/**
 * What it all comes to per month.
 *
 * Transfers are counted but kept out of the total on purpose. A card being
 * paid off is money already counted when it was spent, and including it would
 * roughly double the answer -- which is the mistake that makes somebody
 * distrust the whole screen.
 */
export function monthlyTotals(charges: readonly RecurringCharge[]): MonthlyTotals {
  let subscriptions = 0;
  let obligations = 0;
  let transfers = 0;

  for (const charge of charges) {
    if (charge.kind === "subscription") subscriptions += charge.monthlyAmount;
    else if (charge.kind === "obligation") obligations += charge.monthlyAmount;
    else transfers += charge.monthlyAmount;
  }

  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    subscriptions: round(subscriptions),
    obligations: round(obligations),
    total: round(subscriptions + obligations),
    transfers: round(transfers),
  };
}
