"use server";

import type Stripe from "stripe";

import { createAdminClient } from "@/lib/supabase/admin";
import { env, isStripeConfigured } from "@/lib/env";
import { contactForStripeCustomer, stripeClient } from "@/lib/stripe-customer";
import { placePaidBooking } from "@/lib/actions/public-flyer-actions";
import { settleGroupPass } from "@/lib/actions/public-group-pass-actions";
import { settleTip } from "@/lib/actions/public-tip-actions";
import { settleSaltOrder } from "@/lib/actions/public-salt-actions";
import { recordStripePayment } from "@/lib/actions/payment-plan-actions";
import { getCurrentProfile } from "@/lib/data/team";
import { outboundBaseUrl } from "@/lib/base-url";
import { webhookVerdict, type WebhookVerdict } from "@/lib/webhook-health";

/**
 * Turning a paid Stripe checkout into what the app records about it.
 *
 * This used to live inside the webhook route, which meant it ran exactly
 * when Stripe chose to call us and never otherwise. For an unknown stretch
 * there was no endpoint registered on the Stripe account, so Stripe took a
 * thousand dollars and told nobody. The proposal knew, because the success
 * page asks Stripe directly, but the payment row that feeds the money page,
 * the commission and the receipts was never written.
 *
 * So the same code now runs from two doors. The webhook, when it arrives.
 * And a sync that asks Stripe what has been paid and records anything it
 * finds no row for, which is what a webhook should have been backed by from
 * the start. Both are idempotent on the payment intent, so a session seen
 * from both doors is one payment.
 */

/** Which organisation a plan belongs to, for sessions that predate metadata. */
async function orgForPlan(planId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("payment_plans")
    .select("organization_id")
    .eq("id", planId)
    .maybeSingle();
  return data?.organization_id ?? null;
}

/** A one-off, a deposit, or the start of a subscription. */
export async function recordCheckoutSession(session: Stripe.Checkout.Session): Promise<boolean> {
  const admin = createAdminClient();
  const planId = session.metadata?.plan_id ?? null;
  const instalmentId = session.metadata?.instalment_id ?? null;
  const jobId = session.metadata?.job_id || null;

  const stripeCustomerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
  if (!stripeCustomerId) return false;

  const customerId = await contactForStripeCustomer(stripeCustomerId);

  // The organisation is stamped on the session where we raised it, and read
  // back off the plan for the older sessions that carry no metadata. A
  // webhook has nobody signed in, so guessing one would put a payment in
  // somebody else's books.
  const organizationId =
    session.metadata?.organization_id || (planId ? await orgForPlan(planId) : null);
  if (!organizationId) return false;

  const flyerBookingId = session.metadata?.flyer_booking_id ?? null;
  if (flyerBookingId) {
    await placePaidBooking(flyerBookingId).catch((err) =>
      console.error("placePaidBooking failed:", err)
    );
  }

  const groupPassId = session.metadata?.group_pass_id ?? null;
  if (groupPassId) {
    await settleGroupPass(groupPassId).catch((err) =>
      console.error("settleGroupPass failed:", err)
    );
  }

  // Deliberately carries no job_id in its metadata, so it never lands on the
  // job as revenue: a tip is not money the business earned on the work.
  const jobTipId = session.metadata?.job_tip_id ?? null;
  if (jobTipId) {
    await settleTip(jobTipId).catch((err) => console.error("settleTip failed:", err));
  }

  const saltOrderId = session.metadata?.salt_order_id ?? null;
  if (saltOrderId) {
    await settleSaltOrder(saltOrderId).catch((err) =>
      console.error("settleSaltOrder failed:", err)
    );
  }

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
    workCents: Number(session.metadata?.work_cents) || null,
    paymentIntentId:
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id ?? session.id,
    invoiceId: typeof session.invoice === "string" ? session.invoice : session.invoice?.id ?? null,
  });

  return true;
}

export interface SyncOutcome {
  /** Paid sessions Stripe handed back. */
  checked: number;
  /** Ones we had no row for and now do. */
  recorded: number;
  /** Ones already on file. */
  alreadyHad: number;
  /** Ones we could not place: no organisation on them. */
  unplaced: number;
  /** Names on what was recorded, for the sentence on screen. */
  recordedFor: string[];
}

/** How far back the sync looks. Stripe keeps sessions longer; this is enough
 * to cover any outage anybody would notice, without paging through a year. */
const SYNC_DAYS = 60;

/**
 * Ask Stripe what has been paid, and record anything we have no row for.
 *
 * The backstop the webhook always needed. Runs from a button on the money
 * page and quietly when that page loads, so a missed delivery is caught the
 * next time anybody looks at the money rather than the next time a client
 * rings.
 *
 * Cheap on a normal day: one list call, then one small read per paid
 * session, nearly all of which are already on file and go no further.
 */
export async function syncStripeCheckouts(): Promise<SyncOutcome> {
  const outcome: SyncOutcome = { checked: 0, recorded: 0, alreadyHad: 0, unplaced: 0, recordedFor: [] };
  if (!isStripeConfigured) return outcome;

  const stripe = stripeClient();
  const admin = createAdminClient();
  const since = Math.floor(Date.now() / 1000) - SYNC_DAYS * 86_400;

  const sessions = await stripe.checkout.sessions.list({
    status: "complete",
    created: { gte: since },
    limit: 100,
  });

  for (const session of sessions.data) {
    if (session.payment_status !== "paid") continue;
    outcome.checked += 1;

    const intentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id ?? session.id;

    const { data: existing } = await admin
      .from("payments")
      .select("id")
      .eq("stripe_payment_intent_id", intentId)
      .maybeSingle();
    if (existing) {
      outcome.alreadyHad += 1;
      continue;
    }

    const recorded = await recordCheckoutSession(session).catch((err) => {
      console.error("sync could not record a checkout:", session.id, err);
      return false;
    });

    if (recorded) {
      outcome.recorded += 1;
      const who = session.customer_details?.name || session.customer_details?.email;
      if (who) outcome.recordedFor.push(who);
    } else {
      outcome.unplaced += 1;
    }
  }

  return outcome;
}

/** The sync, from a button. Admin only: it writes money into the books. */
export async function syncStripeCheckoutsNow(): Promise<
  { ok: true; outcome: SyncOutcome } | { ok: false; message: string }
> {
  const profile = await getCurrentProfile();
  const allowed = profile?.roles.includes("admin") || profile?.roles.includes("overhead");
  if (!allowed) return { ok: false, message: "Only an admin can pull payments in." };
  try {
    return { ok: true, outcome: await syncStripeCheckouts() };
  } catch (err) {
    console.error("syncStripeCheckoutsNow failed:", err);
    return { ok: false, message: "Stripe did not answer. Try again in a minute." };
  }
}

/**
 * Whether Stripe can tell this app anything at all.
 *
 * Asked live rather than stored, because the answer changes the moment
 * somebody deletes an endpoint in the Stripe dashboard, and a stored answer
 * would go on saying "fine" for a day.
 */
export async function checkWebhook(): Promise<WebhookVerdict> {
  const baseUrl = await outboundBaseUrl().catch(() => "");
  const ourUrl = `${baseUrl}/api/webhooks/stripe`;

  if (!isStripeConfigured) {
    return webhookVerdict({ configured: false, secretSet: false, ourUrl, endpoints: [] });
  }

  try {
    const list = await stripeClient().webhookEndpoints.list({ limit: 20 });
    return webhookVerdict({
      configured: true,
      secretSet: Boolean(env.stripeWebhookSecret),
      ourUrl,
      endpoints: list.data.map((endpoint) => ({
        url: endpoint.url,
        status: endpoint.status,
        enabledEvents: endpoint.enabled_events,
      })),
    });
  } catch (err) {
    console.error("could not list Stripe webhook endpoints:", err);
    // Not knowing is not the same as knowing it is missing. Say nothing
    // rather than raise an alarm that may be about our own key.
    return webhookVerdict({ configured: true, secretSet: Boolean(env.stripeWebhookSecret), ourUrl, endpoints: [] });
  }
}
