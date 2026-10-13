import { createHash } from "node:crypto";

/**
 * What the app sends QuickBooks Online, built from its own records. Pure:
 * the shapes, the fingerprints that say whether anything changed, and the
 * request ids that make a retried create land once.
 *
 * One way only, as Jobber does it: the app (and Stripe behind it) is where
 * customers, invoices and payments start; QuickBooks receives them for the
 * books. Nothing read back from QuickBooks changes anything here.
 */

export interface LocalCustomer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
}

export interface LocalInvoice {
  id: string;
  customerId: string;
  /** Dollars. */
  amount: number;
  description: string;
  /** "YYYY-MM-DD". */
  txnDate: string;
  dueDate: string | null;
  docNumber: string | null;
  voided: boolean;
}

export interface LocalPayment {
  id: string;
  customerId: string;
  /** Dollars. */
  amount: number;
  txnDate: string;
  method: string;
  /** The app's invoice this pays, if any. */
  invoiceId: string | null;
  reference: string | null;
}

/** QuickBooks caps DisplayName at 500 and forbids a few characters. */
export function displayName(c: Pick<LocalCustomer, "name" | "id">): string {
  const clean = (c.name || "").replace(/[:\t\n\r]/g, " ").replace(/\s+/g, " ").trim();
  return (clean || `Client ${c.id.slice(0, 8)}`).slice(0, 100);
}

export function customerBody(c: LocalCustomer): Record<string, unknown> {
  const body: Record<string, unknown> = { DisplayName: displayName(c) };
  if (c.email) body.PrimaryEmailAddr = { Address: c.email };
  if (c.phone) body.PrimaryPhone = { FreeFormNumber: c.phone };
  if (c.address) body.BillAddr = { Line1: c.address.slice(0, 500) };
  return body;
}

const money = (n: number) => Math.round(n * 100) / 100;

export function invoiceBody(inv: LocalInvoice, qboCustomerId: string, itemId: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    CustomerRef: { value: qboCustomerId },
    TxnDate: inv.txnDate,
    Line: [
      {
        Amount: money(inv.amount),
        Description: inv.description.slice(0, 4000),
        DetailType: "SalesItemLineDetail",
        SalesItemLineDetail: { ItemRef: { value: itemId }, Qty: 1, UnitPrice: money(inv.amount) },
      },
    ],
  };
  if (inv.dueDate) body.DueDate = inv.dueDate;
  if (inv.docNumber) body.DocNumber = inv.docNumber.slice(0, 21);
  return body;
}

export function paymentBody(p: LocalPayment, qboCustomerId: string, qboInvoiceId: string | null): Record<string, unknown> {
  const body: Record<string, unknown> = {
    CustomerRef: { value: qboCustomerId },
    TotalAmt: money(p.amount),
    TxnDate: p.txnDate,
    PrivateNote: [`Paid by ${p.method}`, p.reference].filter(Boolean).join(" · ").slice(0, 4000),
  };
  if (p.reference) body.PaymentRefNum = p.reference.slice(0, 21);
  // Applied to its invoice when that invoice is in QuickBooks; otherwise it
  // lands as an unapplied payment on the customer, which the bookkeeper can
  // apply, rather than not landing at all.
  if (qboInvoiceId) body.Line = [{ Amount: money(p.amount), LinkedTxn: [{ TxnId: qboInvoiceId, TxnType: "Invoice" }] }];
  return body;
}

/** A short fingerprint of what would be sent, so an unchanged record is skipped. */
export function contentHash(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 32);
}

/**
 * QuickBooks' idempotency key (the `requestid` query parameter, at most 50
 * characters). The same record always gives the same id, so a create that
 * timed out and is retried is answered with the first result, not a copy.
 */
export function requestIdFor(organizationId: string, entity: string, localId: string, version = "1"): string {
  return createHash("sha256").update(`${organizationId}:${entity}:${localId}:${version}`).digest("hex").slice(0, 36);
}

/** QBO's query language quotes with single quotes and escapes them with a backslash. */
export function qboQuote(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/** After this many failures in a row a record is left for a person, not retried every hour forever. */
export const MAX_ATTEMPTS = 5;

/** Whether a record should be pushed this run: new, changed, or failed fewer than MAX_ATTEMPTS times. */
export function shouldPush(
  mapped: { qbo_id: string | null; content_hash: string | null; attempts: number; last_error: string | null } | undefined,
  hash: string
): "create" | "update" | "skip" {
  if (!mapped || !mapped.qbo_id) {
    if (mapped && mapped.last_error && mapped.attempts >= MAX_ATTEMPTS) return "skip";
    return "create";
  }
  if (mapped.content_hash === hash) return "skip";
  if (mapped.last_error && mapped.attempts >= MAX_ATTEMPTS) return "skip";
  return "update";
}
