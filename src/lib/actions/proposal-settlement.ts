"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { isStripeConfigured } from "@/lib/env";
import { stripeClient } from "@/lib/stripe-customer";
import { settlementFor } from "@/lib/flyer-settlement";
import { revalidateJobViews } from "@/lib/revalidate-job";

/**
 * Find out whether a client's proposal payment went through, by asking.
 *
 * Same reasoning as the flyer spots. Stripe knows who paid; what it does not
 * do on its own is tell this app, and a webhook is only one way to carry
 * that news. The checkout we opened is recorded on the proposal, so it can
 * be read back whenever anybody looks.
 *
 * Called on the client's own page on the way back from the card form, so a
 * proposal is settled the moment they return, and again wherever the office
 * reads the job. Nothing here is allowed to be visible: a session that could
 * not be read is one to read next time, not an error on the screen of
 * somebody who has just paid.
 */
export async function settleProposalPayment(token: string): Promise<void> {
  try {
    if (!isStripeConfigured) return;

    const admin = createAdminClient();
    const { data: proposal } = await admin
      .from("job_proposals")
      .select("id, job_id, checkout_session_id, paid_at")
      .eq("token", token)
      .maybeSingle();

    if (!proposal?.checkout_session_id || proposal.paid_at) return;

    const session = await stripeClient().checkout.sessions.retrieve(proposal.checkout_session_id);
    const verdict = settlementFor({
      paymentStatus: session.payment_status ?? null,
      status: session.status ?? null,
    });

    if (verdict === "settle") {
      await admin
        .from("job_proposals")
        .update({ paid_at: new Date().toISOString() })
        .eq("id", proposal.id)
        .is("paid_at", null);
      revalidateJobViews(proposal.job_id);
      return;
    }

    if (verdict === "expired") {
      // The card form timed out with nothing paid. Clearing it lets them go
      // round again rather than being told a payment is already pending.
      await admin
        .from("job_proposals")
        .update({ checkout_session_id: null })
        .eq("id", proposal.id);
    }
  } catch {
    // Deliberately silent. Nothing the client can see depends on this.
  }
}

/**
 * The same check, from the office's side.
 *
 * Covers the client who paid and then closed the tab on Stripe's receipt
 * without ever landing back on our page. Their money is in and nothing here
 * knew it, which is exactly the case a webhook is usually bought for.
 */
export async function settleProposalForJob(jobId: string): Promise<void> {
  try {
    if (!isStripeConfigured) return;
    const admin = createAdminClient();
    const { data } = await admin
      .from("job_proposals")
      .select("token, checkout_session_id, paid_at")
      .eq("job_id", jobId)
      .maybeSingle();

    if (!data?.checkout_session_id || data.paid_at) return;
    await settleProposalPayment(data.token);
  } catch {
    // Silent, like the rest of this.
  }
}
