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
    const found = await findByEmail(stripe, contact.email);
    if (found) {
      await link(customerId, found);
      return found;
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

/**
 * Stripe's email filter matches exactly, capitals and all.
 *
 * This is not hypothetical: the live account holds `gpotter719@gmail.com` and
 * `Gpotter719@gmail.com` as two customers, because one invoice was raised
 * against an address somebody had typed with a capital G. The lookup that was
 * meant to prevent a duplicate went and caused one.
 *
 * So ask twice when the two spellings differ. Two calls on the miss path is a
 * cheaper thing to spend than a customer who exists in Stripe twice.
 */
async function findByEmail(stripe: Stripe, email: string): Promise<string | null> {
  const spellings = [email];
  const lowered = email.toLowerCase();
  if (lowered !== email) spellings.push(lowered);

  for (const spelling of spellings) {
    const found = await stripe.customers.list({ email: spelling, limit: 1 });
    if (found.data.length > 0) return found.data[0].id;
  }
  return null;
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

/**
 * Whose payment this was, from the Stripe customer on it.
 *
 * The direct link is the answer whenever there is one. But a contact links to
 * one Stripe customer and the account already contains people who are in
 * Stripe twice — the duplicates this module now prevents were made before it
 * existed, and they still have live cards on them. A payment on the copy we
 * did not link to would otherwise reconcile to nobody, which is the failure
 * this whole file is about.
 *
 * So fall back to the email: ask Stripe who that customer is, and match the
 * address case-insensitively against our contacts. Only on the miss path, so
 * the ordinary payment still costs one query and no API call.
 */
export async function contactForStripeCustomer(stripeCustomerId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("customers")
    .select("id")
    .eq("stripe_customer_id", stripeCustomerId)
    .maybeSingle();
  if (data?.id) return data.id;

  let email: string | null = null;
  try {
    const stripeCustomer = await stripeClient().customers.retrieve(stripeCustomerId);
    // A deleted customer comes back as a tombstone with no email on it.
    if (!stripeCustomer.deleted) email = stripeCustomer.email;
  } catch {
    // A customer we cannot read is a customer we cannot match. The payment is
    // still recorded; it just arrives without a name on it, which is the same
    // outcome as before and better than losing the webhook to a throw.
    return null;
  }
  if (!email) return null;

  const { data: byEmail } = await admin
    .from("customers")
    .select("id")
    // ilike with no wildcards is an exact match that ignores case.
    .ilike("email", email)
    .limit(1)
    .maybeSingle();
  return byEmail?.id ?? null;
}
