/**
 * Taking the money while the client is still on the screen.
 *
 * Accepting used to raise a Stripe invoice and email it. That is a second
 * decision on a different day, in an inbox, and plenty of them never got
 * made. Checkout puts the card form in front of somebody who has already
 * decided, which is the only moment they are certain.
 *
 * Payment methods are left to Stripe rather than pinned here. That is what
 * turns on Link, Apple Pay and Google Pay, which is the autofill a client
 * recognises from every other checkout they have used: their card arrives
 * already filled in and they confirm it with a thumb.
 */

import { isStripeConfigured } from "@/lib/env";
import { outboundBaseUrl } from "@/lib/base-url";
import { getJobCustomerContact } from "@/lib/job-customer";
import { stripeClient, stripeCustomerFor } from "@/lib/stripe-customer";
import { absolute, payPath, schedulePath } from "@/lib/proposal-flow";
import { surchargeCents, SURCHARGE_LABEL } from "@/lib/card-surcharge";

export interface CheckoutRequest {
  token: string;
  jobId: string;
  proposalId: string;
  organizationId: string;
  amountCents: number;
  /** What the client sees on the line item and on their receipt. */
  description: string;
  /** Set when this is the first payment of a plan, so the webhook can land
   * it on the right instalment rather than as a loose amount. */
  planId?: string | null;
  instalmentId?: string | null;
}

export interface CheckoutStarted {
  url: string;
  sessionId: string;
}

/**
 * A hosted checkout for one proposal, or null when we cannot raise one.
 *
 * Null rather than a throw: the caller has already recorded the client's
 * choice, and a payment we could not start is a reason to fall back to an
 * emailed invoice, not a reason to lose the decision.
 */
export async function startProposalCheckout(
  input: CheckoutRequest
): Promise<CheckoutStarted | null> {
  if (!isStripeConfigured) return null;
  if (!(input.amountCents > 0)) return null;

  const contact = await getJobCustomerContact(input.jobId);
  if (!contact) return null;

  // Absolute, and worked out from the running deployment rather than from an
  // env var somebody may not have set. Stripe refuses a relative return URL,
  // and a checkout that will not open is a payment that does not happen.
  const baseUrl = await outboundBaseUrl();
  if (!baseUrl) return null;

  const stripe = stripeClient();
  const fee = surchargeCents(input.amountCents);

  // Reuse the contact's Stripe customer where we know it. A fresh customer
  // per payment is what stopped payments reconciling to anybody, and it also
  // throws away the saved cards that make the next one a single tap.
  const existing = contact.customerId ? await stripeCustomerFor(contact.customerId) : null;

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    ...(existing
      ? { customer: existing }
      : {
          customer_email: contact.email || undefined,
          customer_creation: "always" as const,
        }),
    // Two lines, never one. The card networks require a surcharge to be
    // disclosed before somebody pays rather than found on the receipt, and
    // folding it into the price would also make the job look like it cost
    // more than it was sold for.
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: input.amountCents,
          product_data: { name: input.description },
        },
        quantity: 1,
      },
      ...(fee > 0
        ? [
            {
              price_data: {
                currency: "usd",
                unit_amount: fee,
                product_data: {
                  name: SURCHARGE_LABEL,
                  description: "What the card processor charges to take a card payment.",
                },
              },
              quantity: 1,
            },
          ]
        : []),
    ],
    // Straight to picking a day. They have paid; asking them to find their
    // way back to a link in an email to book is how a paid job sits unbooked.
    success_url: `${absolute(baseUrl, schedulePath(input.token))}?paid=1`,
    cancel_url: absolute(baseUrl, payPath(input.token)),
    metadata: {
      proposal_id: input.proposalId,
      organization_id: input.organizationId,
      job_id: input.jobId,
      // What the work was, apart from the fee. The webhook is told only what
      // arrived, and without this it would credit the client with paying
      // more for the work than they were billed.
      work_cents: String(input.amountCents),
      surcharge_cents: String(fee),
      ...(input.planId ? { plan_id: input.planId } : {}),
      ...(input.instalmentId ? { instalment_id: input.instalmentId } : {}),
    },
  });

  if (!session.url) return null;
  return { url: session.url, sessionId: session.id };
}
