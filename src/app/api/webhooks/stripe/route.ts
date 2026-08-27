import Stripe from "stripe";
import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { env, isStripeConfigured } from "@/lib/env";
import { contactForStripeCustomer } from "@/lib/stripe-customer";
import { recordStripePayment } from "@/lib/actions/payment-plan-actions";

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
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  const admin = createAdminClient();

  if (event.type === "invoice.paid") {
    const invoice = event.data.object as Stripe.Invoice;
    await admin
      .from("invoices")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("stripe_invoice_id", invoice.id);
  } else if (event.type === "invoice.voided") {
    const invoice = event.data.object as Stripe.Invoice;
    await admin.from("invoices").update({ status: "void" }).eq("stripe_invoice_id", invoice.id);
  } else if (event.type === "invoice.marked_uncollectible") {
    const invoice = event.data.object as Stripe.Invoice;
    await admin.from("invoices").update({ status: "uncollectible" }).eq("stripe_invoice_id", invoice.id);
  } else if (event.type === "checkout.session.completed") {
    await recordCheckout(event.data.object as Stripe.Checkout.Session);
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

/** A one-off, a deposit, or the start of a subscription. */
async function recordCheckout(session: Stripe.Checkout.Session): Promise<void> {
  const admin = createAdminClient();
  const planId = session.metadata?.plan_id ?? null;
  const instalmentId = session.metadata?.instalment_id ?? null;
  const jobId = session.metadata?.job_id || null;

  const stripeCustomerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
  if (!stripeCustomerId) return;

  const customerId = await contactForStripeCustomer(stripeCustomerId);

  // The organisation is stamped on the session where we raised it, and read
  // back off the plan for the older sessions that carry no metadata. A
  // webhook has nobody signed in, so guessing one would put a payment in
  // somebody else's books.
  const organizationId =
    session.metadata?.organization_id || (planId ? await orgForPlan(planId) : null);
  if (!organizationId) return;

  // A proposal paid straight from the client's own screen. Recorded here
  // rather than on the success page, because a client who closes the tab on
  // the Stripe receipt has still paid.
  const proposalId = session.metadata?.proposal_id ?? null;
  if (proposalId) {
    await admin
      .from("job_proposals")
      .update({ paid_at: new Date().toISOString() })
      .eq("id", proposalId)
      .is("paid_at", null);
  }

  if (session.subscription && planId) {
    await admin
      .from("payment_plans")
      .update({
        status: "active",
        stripe_subscription_id:
          typeof session.subscription === "string" ? session.subscription : session.subscription.id,
      })
      .eq("id", planId);
  }

  await recordStripePayment({
    organizationId,
    customerId,
    jobId,
    planId,
    instalmentId,
    amountCents: session.amount_total ?? 0,
    paymentIntentId:
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id ?? session.id,
    invoiceId: typeof session.invoice === "string" ? session.invoice : session.invoice?.id ?? null,
  });
}

/** A scheduled instalment, or a subscription renewal. */
async function recordInvoicePayment(invoice: Stripe.Invoice): Promise<void> {
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
  const organizationId = planId ? await orgForPlan(planId) : null;
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
