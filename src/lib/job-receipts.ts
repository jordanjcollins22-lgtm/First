/**
 * Receipts for what the crew had to buy on a job. Materials are ordered
 * ahead; this is the exception, kept with the job so the office can see
 * what was spent and why.
 */

/** "12.50", "$12.50" or "12" as cents; null when blank or not a price. */
export function parseDollars(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/** 1250 as "$12.50". */
export function sayDollars(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** The total of the receipts that have an amount. */
export function receiptsTotal(receipts: { amountCents: number | null }[]): number {
  return receipts.reduce((sum, r) => sum + (r.amountCents ?? 0), 0);
}
