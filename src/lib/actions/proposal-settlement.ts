"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { saltOrdersForPaidProposal } from "@/lib/data/salt-from-proposal";
import { isStripeConfigured } from "@/lib/env";
import { stripeClient } from "@/lib/stripe-customer";
import { settlementFor } from "@/lib/flyer-settlement";
import { revalidateJobViews } from "@/lib/revalidate-job";
import { randomBytes } from "node:crypto";
import { tipFromMetadata } from "@/lib/proposal-tip";

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

    // Two shapes live in this column now. A redirect to the hosted page
    // leaves a checkout session; paying in place leaves a payment intent.
    // Stripe's own prefixes say which, so nothing has to be remembered.
    const reference = proposal.checkout_session_id;
    const stripe = stripeClient();

    let tipCents = 0;
    const verdict = reference.startsWith("pi_")
      ? await (async () => {
          const intent = await stripe.paymentIntents.retrieve(reference);
          tipCents = tipFromMetadata(intent.metadata);
          return settlementFor({
            // An intent says "succeeded" where a session says "paid", so it
            // is mapped rather than passed through and quietly never matching.
            paymentStatus: intent.status === "succeeded" ? "paid" : intent.status,
            status: intent.status === "canceled" ? "expired" : null,
          });
        })()
      : await (async () => {
          const session = await stripe.checkout.sessions.retrieve(reference);
          return settlementFor({
            paymentStatus: session.payment_status ?? null,
            status: session.status ?? null,
          });
        })();

    if (verdict === "settle") {
      await admin
        .from("job_proposals")
        .update({ paid_at: new Date().toISOString() })
        .eq("id", proposal.id)
        .is("paid_at", null);
      // Salting on it goes on the salt route, so the salt is bought ahead.
      await saltOrdersForPaidProposal(admin, proposal.id);
      if (tipCents > 0) await recordTip(admin, proposal.job_id, tipCents).catch(() => {});
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

/**
 * A tip paid with the bill, on the job's tip row: the same row a thank-you
 * link would have used, so a job has one tip whichever way it came.
 */
async function recordTip(admin: ReturnType<typeof createAdminClient>, jobId: string, tipCents: number): Promise<void> {
  const paidAt = new Date().toISOString();
  const { data: existing } = await admin.from("job_tips").select("id, status").eq("job_id", jobId).maybeSingle();
  if (existing) {
    if (existing.status === "paid") return;
    await admin.from("job_tips").update({ status: "paid", amount_cents: tipCents, paid_at: paidAt }).eq("id", existing.id);
    return;
  }
  const [{ data: proposal }, { data: job }] = await Promise.all([
    admin.from("job_proposals").select("organization_id, total_cost").eq("job_id", jobId).maybeSingle(),
    admin.from("jobs").select("id").eq("id", jobId).maybeSingle(),
  ]);
  if (!proposal || !job) return;
  await admin.from("job_tips").insert({
    organization_id: proposal.organization_id,
    job_id: jobId,
    token: randomBytes(16).toString("base64url"),
    status: "paid",
    amount_cents: tipCents,
    job_total_cents: proposal.total_cost != null ? Math.round(Number(proposal.total_cost) * 100) : null,
    paid_at: paidAt,
  });
}
