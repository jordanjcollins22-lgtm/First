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
export async function createAndSendInvoice(
  jobId: string,
  proposalId: string,
  amount: number
): Promise<{ hostedUrl: string | null } | null> {
  if (!isStripeConfigured) return null;
  if (!(amount > 0)) return null;

  const admin = createAdminClient();

  // Guards against double-sending on a duplicate/retried accept. A voided
  // invoice does not count: the client switched to a plan, and if they
  // switch back they need a live one.
  const { data: existing } = await admin
    .from("invoices")
    .select("id, hosted_invoice_url")
    .eq("job_id", jobId)
    .neq("status", "void")
    .maybeSingle();
  if (existing) return { hostedUrl: existing.hosted_invoice_url };

  const contact = await getJobCustomerContact(jobId);
  if (!contact) return null;

  const { data: job } = await admin.from("jobs").select("name").eq("id", jobId).maybeSingle();
  if (!job) return null;

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
  if (!link) return { hostedUrl: null };

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
  return { hostedUrl: link };
}

/** The live invoice on a job, if there is one to pay. */
export async function openInvoiceFor(jobId: string): Promise<{ id: string; hostedUrl: string | null; stripeInvoiceId: string | null; amount: number } | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("invoices")
    .select("id, hosted_invoice_url, stripe_invoice_id, status, amount")
    .eq("job_id", jobId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return { id: data.id, hostedUrl: data.hosted_invoice_url, stripeInvoiceId: data.stripe_invoice_id, amount: Number(data.amount) };
}

/**
 * The invoice's payment page, as Stripe has it now.
 *
 * The link stored at signing can stop matching what Stripe serves, and a
 * client tapping a dead link is a client who does not pay. Read fresh and
 * remembered, so the next tap is right too.
 */
export async function freshInvoiceLink(invoice: { id: string; hostedUrl: string | null; stripeInvoiceId: string | null }): Promise<string | null> {
  if (!isStripeConfigured || !invoice.stripeInvoiceId) return invoice.hostedUrl;
  try {
    const live = await getStripeClient().invoices.retrieve(invoice.stripeInvoiceId);
    const url = live.hosted_invoice_url ?? invoice.hostedUrl;
    if (url && url !== invoice.hostedUrl) {
      await createAdminClient().from("invoices").update({ hosted_invoice_url: url, invoice_pdf: live.invoice_pdf ?? null }).eq("id", invoice.id);
    }
    return url;
  } catch (err) {
    console.error("could not read the invoice back from Stripe:", err);
    return invoice.hostedUrl;
  }
}

/**
 * Voids the job's open invoice.
 *
 * For a client who signed, got an invoice for the whole amount, and then
 * chose a payment plan: the plan bills them from here on, and a second
 * bill for the full amount sitting in their inbox is the surest way to a
 * confused phone call or a double payment.
 */
export async function voidOpenInvoice(jobId: string): Promise<void> {
  const open = await openInvoiceFor(jobId);
  if (!open) return;
  if (isStripeConfigured && open.stripeInvoiceId) {
    await getStripeClient().invoices.voidInvoice(open.stripeInvoiceId).catch(() => {});
  }
  await createAdminClient().from("invoices").update({ status: "void" }).eq("id", open.id);
}
