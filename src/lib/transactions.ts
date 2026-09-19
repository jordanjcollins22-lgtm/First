/**
 * Every transaction, and a way to find the one you are thinking of.
 *
 * Subscriptions answers "what comes back every month" and deliberately hides
 * everything else, which is most of it. This is the other half: all of it, in
 * order, with enough filtering to answer the questions people actually ask of
 * a bank statement -- what did we spend at Home Depot, what went out in June,
 * what is on the Platinum card, where did the money go.
 *
 * Nothing here reads a database. It is the filtering and the arithmetic, which
 * is the part worth checking, and it runs the same on a server as in a test.
 */

export interface Transaction {
  id: string;
  /** The merchant if the bank gave one, otherwise its own description. */
  who: string;
  /** Positive is money leaving, negative is money arriving. */
  amount: number;
  postedOn: string;
  accountId: string | null;
  accountName: string | null;
  category: string | null;
  pending: boolean;
  /** Part of a charge that comes back on a rhythm. */
  recurring: boolean;
}

export type Direction = "out" | "in";

export function directionOf(txn: Pick<Transaction, "amount">): Direction {
  return txn.amount >= 0 ? "out" : "in";
}

/** The bank's category, said the way a person would. */
export function categoryLabel(category: string | null): string {
  if (!category) return "Uncategorised";
  return category
    .toLowerCase()
    .split("_")
    .map((word, i) => (i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(" ");
}

export interface Filters {
  /** Matched against the merchant and the account name. */
  query: string;
  accountId: string | null;
  category: string | null;
  direction: Direction | null;
  /** ISO days, inclusive. */
  from: string | null;
  to: string | null;
  /** Only the ones that come back on a rhythm. */
  recurringOnly: boolean;
}

export const NO_FILTERS: Filters = {
  query: "",
  accountId: null,
  category: null,
  direction: null,
  from: null,
  to: null,
  recurringOnly: false,
};

/**
 * Whether a transaction survives the filters.
 *
 * Every filter narrows; none of them widens. An empty filter set returns
 * everything, which is what somebody opening the page for the first time
 * should see -- a screen that opens on nothing because a default was set is a
 * screen people assume is broken.
 */
export function matches(txn: Transaction, filters: Filters): boolean {
  const query = filters.query.trim().toLowerCase();
  if (query) {
    const haystack = `${txn.who} ${txn.accountName ?? ""} ${categoryLabel(txn.category)}`.toLowerCase();
    // Every word has to appear somewhere, in any order. "home depot june" is
    // how people type, and requiring the exact phrase finds nothing.
    if (!query.split(/\s+/).every((word) => haystack.includes(word))) return false;
  }

  if (filters.accountId && txn.accountId !== filters.accountId) return false;
  if (filters.category && (txn.category ?? "") !== filters.category) return false;
  if (filters.direction && directionOf(txn) !== filters.direction) return false;
  if (filters.from && txn.postedOn < filters.from) return false;
  if (filters.to && txn.postedOn > filters.to) return false;
  if (filters.recurringOnly && !txn.recurring) return false;

  return true;
}

export function applyFilters(txns: readonly Transaction[], filters: Filters): Transaction[] {
  // Newest first. A statement is read from the top, and the thing somebody is
  // looking for is almost always recent.
  return txns.filter((txn) => matches(txn, filters)).sort((a, b) => b.postedOn.localeCompare(a.postedOn));
}

export interface Totals {
  /** Money that left. Always positive here, whatever sign it carried. */
  out: number;
  /** Money that arrived. */
  in: number;
  /** In minus out. Negative means more went out than came in. */
  net: number;
  count: number;
}

/**
 * What the filtered set comes to.
 *
 * Both directions rather than one signed number, because "we spent fourteen
 * thousand and took eleven" and "we were down three" are different sentences
 * and only the first one tells you where to look.
 */
export function totalsOf(txns: readonly Transaction[]): Totals {
  let out = 0;
  let incoming = 0;
  for (const txn of txns) {
    if (txn.amount >= 0) out += txn.amount;
    else incoming += -txn.amount;
  }
  const round = (value: number) => Math.round(value * 100) / 100;
  return { out: round(out), in: round(incoming), net: round(incoming - out), count: txns.length };
}

export interface MonthGroup {
  /** "2026-06". */
  month: string;
  label: string;
  txns: Transaction[];
  totals: Totals;
}

/**
 * The list broken into months.
 *
 * A statement with no months in it is a wall. The subtotal per month is the
 * thing somebody scans for before they read a single line.
 */
export function byMonth(txns: readonly Transaction[]): MonthGroup[] {
  const groups = new Map<string, Transaction[]>();
  for (const txn of txns) {
    const month = txn.postedOn.slice(0, 7);
    const list = groups.get(month) ?? [];
    list.push(txn);
    groups.set(month, list);
  }

  return Array.from(groups.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, list]) => ({
      month,
      label: new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }),
      txns: list,
      totals: totalsOf(list),
    }));
}

/** Where the money went, biggest first. The answer to "what are we spending on". */
export interface CategoryTotal {
  category: string | null;
  label: string;
  out: number;
  count: number;
}

export function spendByCategory(txns: readonly Transaction[]): CategoryTotal[] {
  const totals = new Map<string, CategoryTotal>();
  for (const txn of txns) {
    if (txn.amount <= 0) continue;
    const key = txn.category ?? "";
    const found = totals.get(key) ?? {
      category: txn.category,
      label: categoryLabel(txn.category),
      out: 0,
      count: 0,
    };
    found.out += txn.amount;
    found.count += 1;
    totals.set(key, found);
  }
  return Array.from(totals.values())
    .map((entry) => ({ ...entry, out: Math.round(entry.out * 100) / 100 }))
    .sort((a, b) => b.out - a.out);
}

/** Who took the most, biggest first. */
export interface MerchantTotal {
  who: string;
  out: number;
  count: number;
}

export function spendByMerchant(txns: readonly Transaction[], limit = 12): MerchantTotal[] {
  const totals = new Map<string, MerchantTotal>();
  for (const txn of txns) {
    if (txn.amount <= 0) continue;
    const key = txn.who.toLowerCase();
    const found = totals.get(key) ?? { who: txn.who, out: 0, count: 0 };
    found.out += txn.amount;
    found.count += 1;
    totals.set(key, found);
  }
  return Array.from(totals.values())
    .map((entry) => ({ ...entry, out: Math.round(entry.out * 100) / 100 }))
    .sort((a, b) => b.out - a.out)
    .slice(0, limit);
}

/** Filters from a URL, so a filtered view can be bookmarked and sent to somebody. */
export function filtersFromParams(params: Record<string, string | string[] | undefined>): Filters {
  const one = (key: string): string | null => {
    const value = params[key];
    const found = Array.isArray(value) ? value[0] : value;
    return found?.trim() ? found.trim() : null;
  };

  const direction = one("direction");
  return {
    query: one("q") ?? "",
    accountId: one("account"),
    category: one("category"),
    direction: direction === "out" || direction === "in" ? direction : null,
    from: one("from"),
    to: one("to"),
    recurringOnly: one("recurring") === "1",
  };
}

/** Whether anything is narrowing the list, for an "all of it" button. */
export function anyFilter(filters: Filters): boolean {
  return (
    filters.query.trim() !== "" ||
    filters.accountId != null ||
    filters.category != null ||
    filters.direction != null ||
    filters.from != null ||
    filters.to != null ||
    filters.recurringOnly
  );
}
