import { isStripeConfigured } from "@/lib/env";
import { stripeClient, stripeCustomerFor } from "@/lib/stripe-customer";

/**
 * One payable Stripe invoice for one client's share of one snow event.
 *
 * The same path as the invoice raised when a proposal is signed
 * (lib/invoicing.ts): the contact's one Stripe customer, the invoice first
 * and the line on it second, the total read back off Stripe before anything
 * is finalized, and a draft deleted rather than sent when the total is not
 * what was asked for. It differs only in where the row is kept: a job's
 * `invoices` row is one per job, and a salt client is billed once per storm,
 * so these live in snow_event_invoices, the way payment plan instalments keep
 * their own Stripe invoices.
 *
 * Sends nothing to the client itself. The caller tells them through
 * sendClientMessage, which applies their consent and logs it.
 */

export interface SnowStripeInvoice {
  stripeInvoiceId: string;
  stripeCustomerId: string;
  hostedUrl: string | null;
  pdf: string | null;
}

export async function createSnowStripeInvoice(input: {
  customerId: string;
  amountCents: number;
  description: string;
  /** The proof-of-service page, put on the invoice so the first question is already answered. */
  proofUrl: string | null;
  metadata: Record<string, string>;
}): Promise<SnowStripeInvoice> {
  if (!isStripeConfigured) throw new Error("Stripe is not connected. Add it in Settings › Integrations.");
  if (!(input.amountCents > 0)) throw new Error("Nothing to bill.");

  const stripeCustomerId = await stripeCustomerFor(input.customerId);
  if (!stripeCustomerId) throw new Error("This client has no contact record to bill.");

  const stripe = stripeClient();
  const draft = await stripe.invoices.create({
    customer: stripeCustomerId,
    collection_method: "send_invoice",
    days_until_due: 30,
    // See lib/invoicing.ts: left to its default this has produced a $0 bill.
    pending_invoice_items_behavior: "exclude",
    description: input.proofUrl ? `Photos and times for each visit: ${input.proofUrl}` : undefined,
    metadata: input.metadata,
  });
  const draftId = draft.id;
  if (!draftId) throw new Error("Stripe did not return an invoice to bill against.");

  await stripe.invoiceItems.create({
    customer: stripeCustomerId,
    invoice: draftId,
    amount: input.amountCents,
    currency: "usd",
    description: input.description.slice(0, 500),
  });

  const priced = await stripe.invoices.retrieve(draftId);
  if (priced.total !== input.amountCents) {
    await stripe.invoices.del(draftId).catch(() => {});
    throw new Error(`Stripe priced this invoice at ${priced.total} cents, not ${input.amountCents}. Nothing was sent.`);
  }

  const finalized = await stripe.invoices.finalizeInvoice(draftId);
  return {
    stripeInvoiceId: finalized.id ?? draftId,
    stripeCustomerId,
    hostedUrl: finalized.hosted_invoice_url ?? null,
    pdf: finalized.invoice_pdf ?? null,
  };
}
