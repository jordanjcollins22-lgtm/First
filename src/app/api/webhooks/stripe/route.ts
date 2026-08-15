import Stripe from "stripe";
import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { env, isStripeConfigured } from "@/lib/env";

/**
 * Stripe's webhook — set this URL (https://yourdomain/api/webhooks/stripe)
 * as an endpoint in the Stripe dashboard, subscribed to invoice.paid,
 * invoice.voided, and invoice.marked_uncollectible. Keeps our local
 * `invoices.status` in sync with what actually happened on Stripe's side.
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
  }

  return NextResponse.json({ received: true });
}
