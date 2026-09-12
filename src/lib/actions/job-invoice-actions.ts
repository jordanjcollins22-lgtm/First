"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/team";
import { isStripeConfigured } from "@/lib/env";
import { createAndSendInvoice } from "@/lib/invoicing";
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
    .select("id, status, total_cost, organization_id")
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

  const amount = Number(proposal.total_cost ?? 0);
  if (!(amount > 0)) return { ok: false, message: "The proposal has no total to bill." };

  // Checked here as well as inside, so somebody clicking twice is told what
  // happened rather than watching a button do nothing.
  const { data: existing } = await admin.from("invoices").select("id").eq("job_id", jobId).maybeSingle();
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

  const { data: raised } = await admin.from("invoices").select("id").eq("job_id", jobId).maybeSingle();
  if (!raised) {
    return { ok: false, message: "Nothing was raised. The job needs a contact with a name on file." };
  }

  revalidateJobViews(jobId);
  return { ok: true, message: "Invoice sent. The client has the payment link." };
}
