import Stripe from "stripe";

import { createAdminClient } from "@/lib/supabase/admin";
import { env, isStripeConfigured } from "@/lib/env";
import { getJobCustomerContact } from "@/lib/job-customer";
import { stripeCustomerFor } from "@/lib/stripe-customer";
import { sendSms, toE164 } from "@/lib/sms";

function getStripeClient(): Stripe {
  return new Stripe(env.stripeSecretKey);
}

/**
 * Creates a real, payable Stripe invoice for the amount the client just
 * accepted, then sends the hosted payment link the same way a client
 * message goes out — posted to the external thread and texted if a phone
 * number is on file. Best-effort: a failure here never undoes the client's
 * acceptance, so callers should swallow errors the same way
 * notifyCustomerBySms does.
 */
export async function createAndSendInvoice(jobId: string, proposalId: string, amount: number): Promise<void> {
  if (!isStripeConfigured) return;
  if (!(amount > 0)) return;

  const admin = createAdminClient();

  // Guards against double-sending on a duplicate/retried accept.
  const { data: existing } = await admin.from("invoices").select("id").eq("job_id", jobId).maybeSingle();
  if (existing) return;

  const contact = await getJobCustomerContact(jobId);
  if (!contact) return;

  const { data: job } = await admin.from("jobs").select("name").eq("id", jobId).maybeSingle();
  if (!job) return;

  const stripe = getStripeClient();

  // One Stripe customer per contact, found or created once. Creating a fresh
  // one per invoice is what stopped payments reconciling to anybody.
  const reused = contact.customerId ? await stripeCustomerFor(contact.customerId) : null;
  const stripeCustomer = reused
    ? { id: reused }
    : await stripe.customers.create({
        name: contact.customerName,
        email: contact.email || undefined,
        phone: contact.phone || undefined,
      });

  const expectedCents = Math.round(amount * 100);

  // The invoice first, then the line on it. The other way round — a pending
  // invoice item, then an invoice that is meant to sweep it up — is what sent
  // a client a bill for nothing: `pending_invoice_items_behavior` defaults to
  // "exclude", so the invoice was created without the line, finalized at zero
  // and sent. The item stayed pending on the customer, unbilled. Naming the
  // behaviour as well, because it is a default that has already changed once.
  const draft = await stripe.invoices.create({
    customer: stripeCustomer.id,
    collection_method: "send_invoice",
    days_until_due: 30,
    pending_invoice_items_behavior: "exclude",
  });
  const draftId = draft.id;
  if (!draftId) throw new Error("Stripe did not return an invoice to bill against.");

  await stripe.invoiceItems.create({
    customer: stripeCustomer.id,
    invoice: draftId,
    amount: expectedCents,
    currency: "usd",
    description: job.name || "Landscaping services",
  });

  // Read the price back off Stripe rather than trusting that what we asked
  // for is what it holds. A draft can still be deleted, so a bill for the
  // wrong amount dies here instead of going to a client — which is the whole
  // difference between the bug above being caught and being posted.
  const priced = await stripe.invoices.retrieve(draftId);
  if (priced.total !== expectedCents) {
    await stripe.invoices.del(draftId).catch(() => {});
    throw new Error(
      `Stripe priced this invoice at ${priced.total} cents, not ${expectedCents}. Nothing was sent.`
    );
  }

  const stripeInvoice = await stripe.invoices.finalizeInvoice(draftId);

  const { error } = await admin.from("invoices").insert({
    organization_id: contact.organizationId,
    job_id: jobId,
    proposal_id: proposalId,
    amount,
    status: "open",
    stripe_customer_id: stripeCustomer.id,
    stripe_invoice_id: stripeInvoice.id,
    hosted_invoice_url: stripeInvoice.hosted_invoice_url,
    invoice_pdf: stripeInvoice.invoice_pdf,
    sent_at: new Date().toISOString(),
  });
  if (error) throw error;

  const link = stripeInvoice.hosted_invoice_url;
  if (!link) return;

  const message = `Your invoice for ${job.name || "your project"} is ready: ${link}`;
  await admin.from("job_messages").insert({
    job_id: jobId,
    organization_id: contact.organizationId,
    channel: "external",
    author_type: "team",
    author_name: "Invoice",
    body: message,
  });

  if (contact.phone) {
    const e164 = toE164(contact.phone);
    if (e164) await sendSms(e164, message).catch(() => {});
  }
}
