import Stripe from "stripe";

import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";

export function stripeClient(): Stripe {
  return new Stripe(env.stripeSecretKey);
}

/**
 * This contact in Stripe — the same one, every time.
 *
 * Invoicing used to call customers.create on every invoice, so one contact of
 * ours became five or six customers of Stripe's. Nothing could be tied back
 * to a person, which is the whole of what reconciliation means: a payment
 * arrives, and we can say whose it was.
 *
 * Found or created once and written back to the contact. Idempotent by the
 * column: two calls at the same moment produce at most one extra Stripe
 * customer, and the unique index means only one of them is ever ours.
 */
export async function stripeCustomerFor(customerId: string): Promise<string | null> {
  const admin = createAdminClient();

  const { data: contact } = await admin
    .from("customers")
    .select("id, name, email, phone, stripe_customer_id")
    .eq("id", customerId)
    .maybeSingle();

  if (!contact) return null;
  if (contact.stripe_customer_id) return contact.stripe_customer_id;

  const stripe = stripeClient();

  // Look before creating. A business that has been taking payments already
  // has these people in Stripe, and making second copies of them is the bug
  // this function exists to end.
  if (contact.email) {
    const found = await stripe.customers.list({ email: contact.email, limit: 1 });
    if (found.data.length > 0) {
      await link(customerId, found.data[0].id);
      return found.data[0].id;
    }
  }

  const created = await stripe.customers.create({
    name: contact.name ?? undefined,
    email: contact.email ?? undefined,
    phone: contact.phone ?? undefined,
    // So a payment opened in Stripe's own dashboard says who it belongs to
    // here, not just the other way round.
    metadata: { app_customer_id: customerId },
  });

  await link(customerId, created.id);
  return created.id;
}

async function link(customerId: string, stripeCustomerId: string): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("customers")
    .update({ stripe_customer_id: stripeCustomerId })
    .eq("id", customerId)
    // Only if nobody won the race in the meantime.
    .is("stripe_customer_id", null);
}

/** Whose payment this was, from the Stripe customer on it. */
export async function contactForStripeCustomer(stripeCustomerId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("customers")
    .select("id")
    .eq("stripe_customer_id", stripeCustomerId)
    .maybeSingle();
  return data?.id ?? null;
}
