/**
 * Every dollar that left the bank, and which of them the overhead knows about.
 *
 * The overhead is built from charges that come back on a rhythm, which is the
 * right way to build it and is not the whole story. Around forty thousand a
 * month leaves these accounts and about four and a half thousand of it is
 * overhead — so a screen showing only the four and a half thousand invites the
 * reading that the rest does not exist. Most of it is materials, crew and
 * cards being paid off, which is correct and should be visible as such.
 *
 * The part that matters is the remainder: money that leaves every month, is
 * not a job cost, and never looked regular enough to be detected. A vehicle
 * lease billed twice at different amounts is the example — real, monthly, and
 * invisible. This puts it on the screen next to everything else so somebody
 * can point at it and say "that one counts".
 *
 * Nothing here decides anything. It sorts what is already known into what is
 * accounted for and what is not, and the person does the rest.
 */

/** One outgoing line, as this module needs it. */
export interface Spent {
  id: string;
  key: string;
  who: string;
  amount: number;
  postedOn: string;
  category: string | null;
}

/** What a charge's transactions are doing in the total. */
export type Bucket =
  /** Counted in the overhead. */
  | "overhead"
  /** The same money twice: a card being settled, or our own accounts. */
  | "transfer"
  /** A person said it is not an overhead. */
  | "dismissed"
  /** Not recurring: materials, crew, a one-off. */
  | "uncounted";

export interface MerchantSpend {
  key: string;
  label: string;
  hits: number;
  /** Everything spent here across the window. */
  total: number;
  /** The same, spread across the months the window covers. */
  monthly: number;
  firstSeen: string;
  lastSeen: string;
  category: string | null;
}

export interface SpendReview {
  /** How many months of transactions this is based on. */
  months: number;
  /** Everything leaving, per month. */
  outPerMonth: number;
  overheadPerMonth: number;
  transfersPerMonth: number;
  dismissedPerMonth: number;
  /** Everything else: materials, crew, one-offs. */
  uncountedPerMonth: number;
  /**
   * The biggest merchants no recurring charge accounts for, largest first.
   *
   * The list to read looking for something that belongs in the overhead. Most
   * of it will be materials and will stay where it is.
   */
  uncounted: MerchantSpend[];
  /** How much of the overhead somebody has actually ticked off. */
  checkedCount: number;
  chargeCount: number;
  checkedAmount: number;
  overheadAmount: number;
}

/** Days a month, averaged over a year. */
const DAYS_PER_MONTH = 30.44;

/**
 * How many months of transactions there are.
 *
 * From the span rather than from counting calendar months, because the first
 * and last are nearly always partial: six weeks of data covering parts of
 * three calendar months is one and a half months of spending, not three, and
 * dividing by three understates everything by half.
 */
export function monthsCovered(days: readonly string[]): number {
  if (days.length === 0) return 0;
  let first = days[0];
  let last = days[0];
  for (const day of days) {
    if (day < first) first = day;
    if (day > last) last = day;
  }
  const span = (Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000;
  // A single day of data is still a month's worth of nothing to divide by.
  return Math.max(span / DAYS_PER_MONTH, 1 / DAYS_PER_MONTH);
}

/**
 * Everything that left, sorted into what the overhead knows about.
 *
 * `bucketOf` says where a merchant's spending belongs and comes from the
 * charges that were detected and the decisions taken about them. A merchant
 * with no charge is uncounted by definition.
 */
export function reviewSpend(
  spent: readonly Spent[],
  bucketOf: (key: string) => Bucket,
  checked: { checkedCount: number; chargeCount: number; checkedAmount: number; overheadAmount: number },
  /** How many uncounted merchants to hand back. */
  limit = 12
): SpendReview {
  const months = monthsCovered(spent.map((line) => line.postedOn));

  let out = 0;
  let overhead = 0;
  let transfers = 0;
  let dismissed = 0;
  const uncounted = new Map<string, MerchantSpend>();

  for (const line of spent) {
    if (line.amount <= 0) continue;
    out += line.amount;

    const bucket = bucketOf(line.key);
    if (bucket === "overhead") overhead += line.amount;
    else if (bucket === "transfer") transfers += line.amount;
    else if (bucket === "dismissed") dismissed += line.amount;
    else {
      const found = uncounted.get(line.key);
      if (found) {
        found.hits += 1;
        found.total = round(found.total + line.amount);
        if (line.postedOn < found.firstSeen) found.firstSeen = line.postedOn;
        if (line.postedOn > found.lastSeen) found.lastSeen = line.postedOn;
        found.category ??= line.category;
      } else {
        uncounted.set(line.key, {
          key: line.key,
          label: line.who,
          hits: 1,
          total: round(line.amount),
          monthly: 0,
          firstSeen: line.postedOn,
          lastSeen: line.postedOn,
          category: line.category,
        });
      }
    }
  }

  const perMonth = (amount: number) => (months > 0 ? round(amount / months) : 0);
  const rest = Array.from(uncounted.values())
    .map((merchant) => ({ ...merchant, monthly: perMonth(merchant.total) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);

  return {
    months: Math.round(months * 10) / 10,
    outPerMonth: perMonth(out),
    // The overhead's own figure, not a share of the window: a yearly renewal
    // charged once in six months is a twelfth of itself every month, and
    // dividing what actually left by the window would say otherwise.
    overheadPerMonth: round(checked.overheadAmount),
    transfersPerMonth: perMonth(transfers),
    dismissedPerMonth: perMonth(dismissed),
    uncountedPerMonth: perMonth(out - overhead - transfers - dismissed),
    uncounted: rest,
    ...checked,
  };
}

/**
 * A charge for a merchant the detector never found a rhythm in.
 *
 * Only built when somebody has said this one counts. The monthly figure is
 * what actually left divided by the months it covers, which is the only honest
 * answer for spending with no pattern: a lease billed twice in six months at
 * two different amounts has no typical amount, and pretending it does would be
 * a worse lie than averaging it.
 *
 * The confidence is deliberately zero. Nothing about the rhythm was detected
 * and the screen should say so, rather than dressing a person's judgement up
 * as a finding.
 */
export function chargeFromSpending(
  key: string,
  lines: readonly Spent[],
  months: number
): {
  key: string;
  label: string;
  kind: "obligation";
  cadence: "monthly";
  typicalAmount: number;
  monthlyAmount: number;
  variation: number;
  variableAmount: boolean;
  hits: number;
  firstSeen: string;
  lastSeen: string;
  dayOfMonth: null;
  confidence: number;
  accountId: null;
  transactionIds: string[];
} | null {
  if (lines.length === 0) return null;
  const ordered = [...lines].sort((a, b) => a.postedOn.localeCompare(b.postedOn));
  const total = ordered.reduce((sum, line) => sum + line.amount, 0);
  const over = months > 0 ? months : 1;

  return {
    key,
    label: ordered[ordered.length - 1].who,
    kind: "obligation",
    cadence: "monthly",
    typicalAmount: round(total / over),
    monthlyAmount: round(total / over),
    variation: 1,
    variableAmount: true,
    hits: ordered.length,
    firstSeen: ordered[0].postedOn,
    lastSeen: ordered[ordered.length - 1].postedOn,
    dayOfMonth: null,
    confidence: 0,
    accountId: null,
    transactionIds: ordered.map((line) => line.id),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
