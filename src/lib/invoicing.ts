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

  await stripe.invoiceItems.create({
    customer: stripeCustomer.id,
    amount: Math.round(amount * 100),
    currency: "usd",
    description: job.name || "Landscaping services",
  });

  let stripeInvoice = await stripe.invoices.create({
    customer: stripeCustomer.id,
    collection_method: "send_invoice",
    days_until_due: 30,
  });
  stripeInvoice = await stripe.invoices.finalizeInvoice(stripeInvoice.id);

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
