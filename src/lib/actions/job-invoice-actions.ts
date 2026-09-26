"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/team";
import { isStripeConfigured } from "@/lib/env";
import { createAndSendInvoice, openInvoiceFor, voidOpenInvoice } from "@/lib/invoicing";
import { isOwnerLevel } from "@/lib/roles";
import { agreedTotal } from "@/lib/agreed-total";
import { revalidateJobViews } from "@/lib/revalidate-job";
import { reportStripeFailure } from "@/lib/data/payments-health";

export type RaiseResult = { ok: true; message: string } | { ok: false; message: string };

/**
 * Bill a job the office has already sold.
 *
 * There was no way to do this. An invoice was raised in exactly one place —
 * the client's own screen, on the way through paying in full, and only if the
 * card checkout failed to start. Every other route to a sale, a client who
 * picked instalments, one who rang up and said yes, one whose acceptance was
 * recorded by hand, ended with a job nobody could bill from the app.
 *
 * Guarded on the sale rather than on the work. What stops somebody billing
 * for work that has not happened is the amount they put on the invoice, and
 * the deposit that buys the materials is due before a crew ever turns up.
 */
export async function raiseInvoiceForJob(jobId: string): Promise<RaiseResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Not signed in." };
  if (!isStripeConfigured) {
    return { ok: false, message: "Stripe isn't connected, so we can't send a payable invoice yet." };
  }

  const admin = createAdminClient();

  // Scoped through the proposal, because `jobs` carries no organization of
  // its own — it reaches one through its property's contact. The proposal
  // does, and a job with no proposal is not one there is anything to bill for.
  const { data: proposal } = await admin
    .from("job_proposals")
    .select("id, status, total_cost, discount_amount, organization_id")
    .eq("job_id", jobId)
    .eq("organization_id", profile.organization_id)
    .maybeSingle();
  if (!proposal) return { ok: false, message: "There's no proposal on this job to bill from." };

  const { data: job } = await admin.from("jobs").select("id, status").eq("id", jobId).maybeSingle();
  if (!job) return { ok: false, message: "We couldn't find that job." };
  if (job.status === "cancelled") return { ok: false, message: "This job is cancelled." };

  if (proposal.status !== "accepted" && job.status !== "approved") {
    return { ok: false, message: "Nobody has accepted this proposal yet." };
  }

  // The price after the discount. Billing the price before it is how a
  // client who took a pre-book special got an invoice for the full amount.
  const amount = agreedTotal(proposal) ?? 0;
  if (!(amount > 0)) return { ok: false, message: "The proposal has no total to bill." };

  // Checked here as well as inside, so somebody clicking twice is told what
  // happened rather than watching a button do nothing.
  const { data: existing } = await admin.from("invoices").select("id").eq("job_id", jobId).neq("status", "void").limit(1).maybeSingle();
  if (existing) return { ok: false, message: "There's already an invoice on this job." };

  try {
    await createAndSendInvoice(jobId, proposal.id, amount);
  } catch (err) {
    console.error("raising an invoice failed:", err);
    // If Stripe itself is the problem rather than this one contact, that is
    // worth waking somebody over — every other payment is failing too.
    reportStripeFailure(proposal.organization_id, err).catch(() => {});
    return { ok: false, message: "Stripe wouldn't take that. Check the contact's details and try again." };
  }

  const { data: raised } = await admin.from("invoices").select("id").eq("job_id", jobId).neq("status", "void").limit(1).maybeSingle();
  if (!raised) {
    return { ok: false, message: "Nothing was raised. The job needs a contact with a name on file." };
  }

  revalidateJobViews(jobId);
  return { ok: true, message: "Invoice sent. The client has the payment link." };
}

/**
 * Bill it again at the price the proposal now says.
 *
 * A Stripe invoice cannot be changed once it is out, and the price on a
 * proposal can: a discount taken off after the bill went, a trim, a
 * correction. The old bill is voided, on Stripe and here, and a fresh one
 * goes for the agreed total, with the client texted the new link the way
 * they were texted the first. Owner or admin only, and only while the old
 * one is unpaid.
 */
export async function reissueInvoiceForJob(jobId: string): Promise<RaiseResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Not signed in." };
  if (!isOwnerLevel(profile.roles) && !profile.roles.includes("admin")) {
    return { ok: false, message: "Only an owner or admin can reissue an invoice." };
  }
  if (!isStripeConfigured) return { ok: false, message: "Stripe isn't connected." };

  const admin = createAdminClient();
  const { data: proposal } = await admin
    .from("job_proposals")
    .select("id, status, total_cost, discount_amount, organization_id")
    .eq("job_id", jobId)
    .eq("organization_id", profile.organization_id)
    .maybeSingle();
  if (!proposal) return { ok: false, message: "There's no proposal on this job to bill from." };
  const amount = agreedTotal(proposal) ?? 0;
  if (!(amount > 0)) return { ok: false, message: "The proposal has no total to bill." };

  const open = await openInvoiceFor(jobId);
  if (!open) return { ok: false, message: "There's no unpaid invoice to replace." };
  const { data: current } = await admin.from("invoices").select("amount").eq("id", open.id).maybeSingle();
  if (current && Math.abs(Number(current.amount) - amount) < 0.5) {
    return { ok: false, message: `The invoice is already $${Math.round(amount).toLocaleString()}.` };
  }

  try {
    await voidOpenInvoice(jobId);
    await createAndSendInvoice(jobId, proposal.id, amount);
  } catch (err) {
    console.error("reissuing an invoice failed:", err);
    reportStripeFailure(proposal.organization_id, err).catch(() => {});
    return { ok: false, message: "Stripe wouldn't take that. The old invoice may already be voided; check the job and try again." };
  }

  revalidateJobViews(jobId);
  return { ok: true, message: `Reissued at $${Math.round(amount).toLocaleString()}. The old invoice is voided and the client has the new link.` };
}
