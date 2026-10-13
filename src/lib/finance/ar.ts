import { addDays, daysBetween } from "@/lib/finance/dates";

/**
 * Accounts receivable: who owes what, how late, and what that does to days
 * sales outstanding. Pure, so the buckets and the late-fee rule are tested
 * without a database.
 */

/** Stripe invoices are raised with 30 days to pay (src/lib/invoicing.ts). */
export const DEFAULT_TERMS_DAYS = 30;

export interface ArInvoice {
  id: string;
  customerName: string;
  /** Dollars still owed. */
  amount: number;
  /** "YYYY-MM-DD" the invoice went out. */
  issuedOn: string;
  /** "YYYY-MM-DD" it is due; issued + terms when not stated. */
  dueOn?: string | null;
  hostedUrl?: string | null;
}

export type AgingKey = "current" | "1-30" | "31-60" | "61-90" | "90+";

export const AGING_BUCKETS: { key: AgingKey; label: string }[] = [
  { key: "current", label: "Current" },
  { key: "1-30", label: "1–30 days late" },
  { key: "31-60", label: "31–60" },
  { key: "61-90", label: "61–90" },
  { key: "90+", label: "90+" },
];

export function dueDateOf(inv: Pick<ArInvoice, "issuedOn" | "dueOn">, termsDays = DEFAULT_TERMS_DAYS): string {
  return inv.dueOn || addDays(inv.issuedOn, termsDays);
}

/** Days past due on `today`; zero or negative means not yet due. */
export function daysPastDue(inv: Pick<ArInvoice, "issuedOn" | "dueOn">, today: string, termsDays = DEFAULT_TERMS_DAYS): number {
  return daysBetween(dueDateOf(inv, termsDays), today);
}

export function agingKey(daysLate: number): AgingKey {
  if (daysLate <= 0) return "current";
  if (daysLate <= 30) return "1-30";
  if (daysLate <= 60) return "31-60";
  if (daysLate <= 90) return "61-90";
  return "90+";
}

export interface AgingRow extends ArInvoice {
  dueOn: string;
  daysLate: number;
  bucket: AgingKey;
  /** Days since it went out: what "AR over 30 days" is measured on. */
  ageDays: number;
}

export interface Aging {
  total: number;
  buckets: { key: AgingKey; label: string; amount: number; count: number }[];
  /** Owed on invoices more than 30 days old. */
  over30: number;
  rows: AgingRow[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function arAging(invoices: ArInvoice[], today: string, termsDays = DEFAULT_TERMS_DAYS): Aging {
  const rows: AgingRow[] = invoices
    .filter((i) => i.amount > 0)
    .map((i) => {
      const dueOn = dueDateOf(i, termsDays);
      const daysLate = daysBetween(dueOn, today);
      return { ...i, dueOn, daysLate, bucket: agingKey(daysLate), ageDays: daysBetween(i.issuedOn, today) };
    })
    .sort((a, b) => b.daysLate - a.daysLate || b.amount - a.amount);
  const buckets = AGING_BUCKETS.map((b) => {
    const inIt = rows.filter((r) => r.bucket === b.key);
    return { ...b, amount: round2(inIt.reduce((s, r) => s + r.amount, 0)), count: inIt.length };
  });
  return {
    total: round2(rows.reduce((s, r) => s + r.amount, 0)),
    buckets,
    over30: round2(rows.filter((r) => r.ageDays > 30).reduce((s, r) => s + r.amount, 0)),
    rows,
  };
}

/**
 * Days sales outstanding: what is owed now, as days of recent invoicing.
 * Null when nothing was invoiced in the window, because a ratio over zero
 * says nothing.
 */
export function dso(arBalance: number, invoicedInWindow: number, windowDays = 90): number | null {
  if (!(invoicedInWindow > 0)) return null;
  return Math.round((arBalance / invoicedInWindow) * windowDays);
}

export interface LateFeeSettings {
  enabled: boolean;
  /** When late fees were switched on. Invoices issued before it never get one. */
  startedAt: string | null;
  kind: "percent" | "flat";
  /** Percent of the balance, or dollars. */
  amount: number;
  graceDays: number;
}

/**
 * The late fee an invoice would carry today, in dollars. Zero when fees are
 * off, the invoice predates switching them on (no backlog), or it is still
 * inside the grace period. One fee per invoice; the app never compounds.
 *
 * Maryland limits what can be charged on consumer contracts; the setting
 * is off until the owner confirms terms the client agreed to in writing.
 */
export function lateFeeFor(inv: Pick<ArInvoice, "amount" | "issuedOn" | "dueOn">, s: LateFeeSettings, today: string, termsDays = DEFAULT_TERMS_DAYS): number {
  if (!s.enabled || !s.startedAt || !(inv.amount > 0)) return 0;
  if (inv.issuedOn < s.startedAt.slice(0, 10)) return 0;
  if (daysPastDue(inv, today, termsDays) <= Math.max(0, s.graceDays)) return 0;
  const fee = s.kind === "flat" ? s.amount : (inv.amount * s.amount) / 100;
  return round2(Math.max(0, fee));
}
