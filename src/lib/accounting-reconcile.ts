/**
 * Billed against banked, per contact.
 *
 * The two halves of the money live in different places and were never put
 * next to each other: invoices are what the business asked for, payments are
 * what arrived. Both totals were on screen somewhere; the difference between
 * them was nowhere.
 *
 * Reconciled per contact rather than per invoice, because per invoice is not
 * available. The payments export carries the source system's internal invoice
 * id and the invoice export carries the human invoice number, and neither file
 * has both — there is no join, and inventing one by matching on amount would
 * pair a $500 payment with whichever $500 bill it found first.
 *
 * Per contact is a claim that is actually true: this person was billed this
 * much and has paid this much. It is also the granularity somebody rings
 * about.
 */

export interface BilledRow {
  customerId: string;
  customerName: string | null;
  amountCents: number;
  /** Whether the bill itself is settled, however that was established. */
  settled: boolean;
}

export interface BankedRow {
  customerId: string | null;
  amountCents: number;
}

export interface ContactBalance {
  customerId: string;
  customerName: string | null;
  billedCents: number;
  receivedCents: number;
  /** Billed and not received. Never negative — see `creditCents`. */
  owedCents: number;
  /** Received beyond what was billed. Usually work invoiced outside this
   * system rather than an actual overpayment, which is exactly why it is
   * shown rather than netted away. */
  creditCents: number;
  invoices: number;
}

export interface Reconciliation {
  billedCents: number;
  receivedCents: number;
  /** What is owed, added up across contacts rather than as one subtraction:
   * one client's overpayment must never cancel another's debt. */
  owedCents: number;
  creditCents: number;
  /** Money received against nobody at all. Not part of any balance, and
   * reported so the totals reconcile rather than quietly disagreeing. */
  unattributedCents: number;
  balances: ContactBalance[];
}

export function reconcile(billed: BilledRow[], banked: BankedRow[]): Reconciliation {
  const byContact = new Map<string, ContactBalance>();
  let unattributedCents = 0;

  const get = (customerId: string, name: string | null): ContactBalance => {
    const found = byContact.get(customerId);
    if (found) {
      if (!found.customerName && name) found.customerName = name;
      return found;
    }
    const made: ContactBalance = {
      customerId,
      customerName: name,
      billedCents: 0,
      receivedCents: 0,
      owedCents: 0,
      creditCents: 0,
      invoices: 0,
    };
    byContact.set(customerId, made);
    return made;
  };

  for (const row of billed) {
    const balance = get(row.customerId, row.customerName);
    balance.billedCents += row.amountCents;
    balance.invoices += 1;
  }

  for (const row of banked) {
    if (!row.customerId) {
      unattributedCents += row.amountCents;
      continue;
    }
    get(row.customerId, null).receivedCents += row.amountCents;
  }

  let billedCents = 0;
  let receivedCents = 0;
  let owedCents = 0;
  let creditCents = 0;

  for (const balance of byContact.values()) {
    const difference = balance.billedCents - balance.receivedCents;
    balance.owedCents = Math.max(0, difference);
    balance.creditCents = Math.max(0, -difference);

    billedCents += balance.billedCents;
    receivedCents += balance.receivedCents;
    owedCents += balance.owedCents;
    creditCents += balance.creditCents;
  }

  return {
    billedCents,
    receivedCents,
    owedCents,
    creditCents,
    unattributedCents,
    balances: [...byContact.values()],
  };
}

/** Owed most first: the list is a work queue and the biggest gap is the one
 * worth an afternoon. */
export function byOwed(balances: ContactBalance[]): ContactBalance[] {
  return [...balances]
    .filter((b) => b.owedCents > 0)
    .sort((a, b) => b.owedCents - a.owedCents);
}

/** Money in with nothing billed for it, largest first. Each one is either
 * work invoiced somewhere else or a payment on the wrong contact, and both
 * are worth knowing. */
export function byCredit(balances: ContactBalance[]): ContactBalance[] {
  return [...balances]
    .filter((b) => b.creditCents > 0)
    .sort((a, b) => b.creditCents - a.creditCents);
}

/** Contacts who paid us and were never billed through this app at all. The
 * back catalogue, and the list a proposal has to be written for. */
export function neverBilled(balances: ContactBalance[]): ContactBalance[] {
  return [...balances]
    .filter((b) => b.invoices === 0 && b.receivedCents > 0)
    .sort((a, b) => b.receivedCents - a.receivedCents);
}

const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

/** The line at the top. States the gap rather than making somebody subtract
 * two numbers that are deliberately next to each other. */
export function reconcileLine(result: Reconciliation): string {
  if (result.billedCents === 0 && result.receivedCents === 0) {
    return "Nothing billed and nothing received yet.";
  }

  const parts = [
    `${money(result.billedCents)} billed`,
    `${money(result.receivedCents)} received`,
  ];
  if (result.owedCents > 0) parts.push(`${money(result.owedCents)} still owed`);
  if (result.creditCents > 0) {
    parts.push(`${money(result.creditCents)} taken with no invoice behind it`);
  }
  if (result.unattributedCents > 0) {
    parts.push(`${money(result.unattributedCents)} not matched to anybody`);
  }
  return `${parts.join(" · ")}.`;
}
