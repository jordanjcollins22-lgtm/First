import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { describeError, log } from "@/lib/log";
import { recordCheckoutSession } from "@/lib/actions/stripe-settlement";
import { env, isStripeConfigured } from "@/lib/env";
import { contactForStripeCustomer } from "@/lib/stripe-customer";
import { recordStripePayment } from "@/lib/actions/payment-plan-actions";
import { accrueForStripeInvoice } from "@/lib/data/commission-accrual";

/**
 * Stripe's webhook — set this URL (https://yourdomain/api/webhooks/stripe)
 * as an endpoint in the Stripe dashboard, subscribed to invoice.paid,
 * invoice.voided, invoice.marked_uncollectible, checkout.session.completed
 * and customer.subscription.deleted.
 *
 * Two jobs. It keeps our invoice statuses in step with Stripe's, and it
 * records the money itself against the contact who paid it — which only
 * works because a contact now has exactly one Stripe customer. Before that,
 * a payment resolved to an id nobody recognised.
 *
 * Everything it writes is idempotent. Stripe retries on any non-2xx, and a
 * webhook delivered twice must not produce a customer who appears to have
 * paid twice.
 */
export async function POST(request: NextRequest) {
  if (!isStripeConfigured) {
    return NextResponse.json({ error: "Stripe isn't configured on the server." }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature") ?? "";
  const rawBody = await request.text();

  const stripe = new Stripe(env.stripeSecretKey);
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, env.stripeWebhookSecret);
  } catch (err) {
    log.warn("stripe.webhook.rejected", { reason: "invalid signature", error: describeError(err) });
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }
  log.info("stripe.webhook.received", { type: event.type, eventId: event.id });

  const admin = createAdminClient();

  if (event.type === "invoice.paid") {
    const invoice = event.data.object as Stripe.Invoice;
    await admin
      .from("invoices")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("stripe_invoice_id", invoice.id);
    // A snow event's bill keeps its own row, one per client per storm.
    await snowInvoices(admin).update({ status: "paid", paid_at: new Date().toISOString() }).eq("stripe_invoice_id", invoice.id);
    // Commission on this payment, for whoever carried the job. Off until the
    // owner switches it on; idempotent and never throws, so a retried
    // delivery adds nothing and a failure here cannot fail the webhook.
    await accrueForStripeInvoice(invoice.id);
  } else if (event.type === "invoice.voided") {
    const invoice = event.data.object as Stripe.Invoice;
    await admin.from("invoices").update({ status: "void" }).eq("stripe_invoice_id", invoice.id);
    await snowInvoices(admin).update({ status: "void" }).eq("stripe_invoice_id", invoice.id);
  } else if (event.type === "invoice.marked_uncollectible") {
    const invoice = event.data.object as Stripe.Invoice;
    await admin.from("invoices").update({ status: "uncollectible" }).eq("stripe_invoice_id", invoice.id);
  } else if (event.type === "checkout.session.completed") {
    // Shared with the sync on the money page, so a session Stripe never
    // delivered is recorded by exactly the same code when somebody looks.
    await recordCheckoutSession(event.data.object as Stripe.Checkout.Session);
  } else if (event.type === "invoice.payment_succeeded") {
    // The instalments after the first, and every renewal of a subscription.
    await recordInvoicePayment(event.data.object as Stripe.Invoice);
  } else if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as Stripe.Subscription;
    await admin
      .from("payment_plans")
      .update({ status: "cancelled" })
      .eq("stripe_subscription_id", subscription.id);
  }

  return NextResponse.json({ received: true });
}

/** A scheduled instalment, or a subscription renewal. */
async function recordInvoicePayment(invoice: Stripe.Invoice): Promise<void> {
  // Cash or a check marked as paid outside Stripe was recorded by the
  // person who took it; a second row here would count it twice.
  if ((invoice as { paid_out_of_band?: boolean }).paid_out_of_band) return;
  const admin = createAdminClient();

  const stripeCustomerId =
    typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id ?? null;
  if (!stripeCustomerId) return;

  const customerId = await contactForStripeCustomer(stripeCustomerId);

  // Which instalment this was, if it was one of ours.
  const { data: instalment } = await admin
    .from("payment_plan_instalments")
    .select("id, plan_id")
    .eq("stripe_invoice_id", invoice.id)
    .maybeSingle();

  const planId = instalment?.plan_id ?? null;

  // Not an instalment: the invoice raised when the proposal was signed.
  // Paying it is a payment on the job like any other.
  if (!planId) {
    const { data: jobInvoice } = await admin
      .from("invoices")
      .select("id, job_id, organization_id")
      .eq("stripe_invoice_id", invoice.id)
      .maybeSingle();
    if (!jobInvoice) {
      await recordSnowInvoicePayment(invoice, customerId);
      return;
    }
    await recordStripePayment({
      organizationId: jobInvoice.organization_id,
      customerId,
      jobId: jobInvoice.job_id,
      planId: null,
      instalmentId: null,
      amountCents: invoice.amount_paid ?? 0,
      paymentIntentId: invoice.id ?? null,
      invoiceId: invoice.id ?? null,
    });
    return;
  }

  const organizationId = await orgForPlan(planId);
  if (!organizationId) return;

  const { data: plan } = await admin
    .from("payment_plans")
    .select("job_id")
    .eq("id", planId!)
    .maybeSingle();

  await recordStripePayment({
    organizationId,
    customerId,
    jobId: plan?.job_id ?? null,
    planId,
    instalmentId: instalment?.id ?? null,
    amountCents: invoice.amount_paid ?? 0,
    paymentIntentId: invoice.id ?? null,
    invoiceId: invoice.id ?? null,
  });
}

async function orgForPlan(planId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("payment_plans")
    .select("organization_id")
    .eq("id", planId)
    .maybeSingle();
  return data?.organization_id ?? null;
}

/** snow_event_invoices is newer than the generated types. */
function snowInvoices(admin: ReturnType<typeof createAdminClient>) {
  return (admin as unknown as SupabaseClient).from("snow_event_invoices");
}

/** A snow event's invoice, paid: recorded against the client and the salt job, like any other payment. */
async function recordSnowInvoicePayment(invoice: Stripe.Invoice, customerId: string | null): Promise<void> {
  const admin = createAdminClient();
  const { data } = await snowInvoices(admin).select("id, organization_id, job_id").eq("stripe_invoice_id", invoice.id).maybeSingle();
  const row = data as { id: string; organization_id: string; job_id: string | null } | null;
  if (!row) return;
  await recordStripePayment({
    organizationId: row.organization_id,
    customerId,
    jobId: row.job_id,
    planId: null,
    instalmentId: null,
    amountCents: invoice.amount_paid ?? 0,
    paymentIntentId: invoice.id ?? null,
    invoiceId: invoice.id ?? null,
  });
}
