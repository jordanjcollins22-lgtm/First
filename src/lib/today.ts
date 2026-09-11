/**
 * What happened today, and what still has to.
 *
 * My Day answered "what is on me" as a set of piles: visits coming, write-ups
 * owed, jobs being carried. All true, and all of it about the week rather than
 * the day. The question somebody opens their phone with at six in the evening
 * is narrower than that and nothing answered it: did we sell anything, did any
 * money turn up, and is there anything left before I stop.
 *
 * Sold and collected are kept apart on purpose, because they are different
 * facts and conflating them is how a good day on paper turns out to be a
 * quote somebody accepted and never paid. A proposal accepted today is a sale.
 * A cheque cleared today is money, and it is usually for something sold weeks
 * ago. Neither is a proxy for the other.
 */

export interface SoldToday {
  jobId: string;
  customerName: string;
  address: string;
  /** What they accepted, in dollars. Null on a proposal with no total. */
  value: number | null;
  at: string;
}

export interface MoneyToday {
  /** What it was against, for a line somebody can recognise. */
  label: string;
  amount: number;
  /** "Invoice", "Cash", "Card" — how it arrived. */
  via: string;
  at: string;
}

export interface TodayInput {
  sold: SoldToday[];
  money: MoneyToday[];
  /** Visits booked for today, however they are going. */
  visits: { jobId: string; customerName: string; address: string; at: string; status: string }[];
  /** Jobs with a crew on them today. */
  onSite: { jobId: string; customerName: string; address: string }[];
  /** Write-ups and quotes owed, already worked out by My Day. */
  owed: number;
}

export interface TodayView {
  sold: SoldToday[];
  soldValue: number;
  money: MoneyToday[];
  moneyIn: number;
  visits: TodayInput["visits"];
  onSite: TodayInput["onSite"];
  owed: number;
  /** Whether anything at all happened. A quiet day says so rather than
   * showing four empty headings. */
  quiet: boolean;
  /** The one line worth reading if nothing else is. */
  headline: string;
}

/**
 * The day, as one object.
 *
 * The headline is deliberately not a cheerful summary. It says the most
 * consequential true thing, in this order: money in, then work sold, then
 * what is still owed, then what is booked. A day with three visits and
 * nothing sold should read as three visits and nothing sold.
 */
export function buildToday(input: TodayInput): TodayView {
  const soldValue = round(input.sold.reduce((sum, row) => sum + (row.value ?? 0), 0));
  const moneyIn = round(input.money.reduce((sum, row) => sum + row.amount, 0));

  const quiet =
    input.sold.length === 0 &&
    input.money.length === 0 &&
    input.visits.length === 0 &&
    input.onSite.length === 0;

  return {
    sold: [...input.sold].sort((a, b) => b.at.localeCompare(a.at)),
    soldValue,
    money: [...input.money].sort((a, b) => b.at.localeCompare(a.at)),
    moneyIn,
    visits: [...input.visits].sort((a, b) => a.at.localeCompare(b.at)),
    onSite: input.onSite,
    owed: input.owed,
    quiet,
    headline: headlineFor({ soldValue, moneyIn, input, quiet }),
  };
}

function headlineFor({
  soldValue,
  moneyIn,
  input,
  quiet,
}: {
  soldValue: number;
  moneyIn: number;
  input: TodayInput;
  quiet: boolean;
}): string {
  if (quiet && input.owed === 0) return "Nothing on today, and nothing owed.";
  if (moneyIn > 0 && input.sold.length > 0) {
    return `${money(moneyIn)} in and ${money(soldValue)} sold.`;
  }
  if (moneyIn > 0) return `${money(moneyIn)} in today.`;
  if (input.sold.length > 0) {
    return input.sold.length === 1
      ? `One job sold, ${money(soldValue)}.`
      : `${input.sold.length} jobs sold, ${money(soldValue)}.`;
  }
  if (input.owed > 0) {
    return input.owed === 1
      ? "Nothing sold today. One write-up still owed."
      : `Nothing sold today. ${input.owed} write-ups still owed.`;
  }
  if (input.visits.length > 0) {
    return input.visits.length === 1
      ? "One visit booked, nothing sold yet."
      : `${input.visits.length} visits booked, nothing sold yet.`;
  }
  if (input.onSite.length > 0) return "Crew is out, nothing sold today.";
  return "Nothing sold today.";
}

function money(value: number): string {
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The same day, told how much is still owed.
 *
 * My Day works that count out separately and in parallel with this, so it is
 * not known when the day is first built. Folded in afterwards rather than
 * patched onto the object, because the headline is derived from it: setting
 * the number without rebuilding the sentence would leave a panel saying
 * "nothing sold today" above a count of three write-ups nobody has done.
 */
export function withOwed(view: TodayView, owed: number): TodayView {
  if (owed === view.owed) return view;
  return buildToday({
    sold: view.sold,
    money: view.money,
    visits: view.visits,
    onSite: view.onSite,
    owed,
  });
}

/** Whether a timestamp falls on the given local day. */
export function isOnDay(at: string | null, dayKey: string): boolean {
  if (!at) return false;
  const parsed = new Date(at);
  if (Number.isNaN(parsed.getTime())) return false;
  return localDayKey(parsed) === dayKey;
}

/** A date as the local calendar day it falls on. */
export function localDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}
