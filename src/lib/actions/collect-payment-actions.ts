"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/team";
import { getJobCustomerContact } from "@/lib/job-customer";
import { recordManualPayment } from "@/lib/actions/payment-plan-actions";
import { stripeClient } from "@/lib/stripe-customer";
import { isStripeConfigured } from "@/lib/env";
import { revalidateJobViews } from "@/lib/revalidate-job";
import { describeDbError } from "@/lib/setup-errors";
import { collectedThreadNote, isOfflineMethod, type OfflineMethod } from "@/lib/collect-payment";
import { log } from "@/lib/log";

export type CollectResult = { ok: true; message: string } | { ok: false; message: string };

/**
 * The cash or the check is in hand.
 *
 * One press does the three things that used to be three screens: records
 * the payment on the job, marks the invoice paid, and tells Stripe the
 * invoice was paid outside it so it stops waiting. Any signed-in team
 * member can do it, because whoever is standing in the driveway with the
 * check is the person who knows.
 */
export async function markPaymentCollected(input: {
  invoiceId: string;
  method: OfflineMethod;
  amountCents: number;
  /** The day the money changed hands, YYYY-MM-DD, if not today. */
  receivedAt?: string;
  note?: string;
}): Promise<CollectResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };
    if (!isOfflineMethod(input.method)) return { ok: false, message: "Cash or check." };
    if (!(input.amountCents > 0)) return { ok: false, message: "How much was it?" };

    const supabase = await createClient();
    const { data: invoice, error } = await supabase
      .from("invoices")
      .select("id, job_id, organization_id, status, stripe_invoice_id")
      .eq("id", input.invoiceId)
      .maybeSingle();
    if (error) return { ok: false, message: describeDbError(error) };
    if (!invoice) return { ok: false, message: "That invoice is not on file." };
    if (invoice.status === "paid") return { ok: false, message: "That invoice is already marked paid." };

    const contact = await getJobCustomerContact(invoice.job_id);
    if (!contact) return { ok: false, message: "The job has no client on it." };

    const recorded = await recordManualPayment({
      jobId: invoice.job_id,
      customerId: contact.customerId,
      invoiceId: invoice.id,
      amountCents: input.amountCents,
      method: input.method,
      receivedAt: input.receivedAt,
      note: input.note,
    });
    if (!recorded.ok) return recorded;

    const collectorName = profile.first_name || profile.full_name || "the team";
    const admin = createAdminClient();
    const { error: updateError } = await admin
      .from("invoices")
      .update({
        status: "paid",
        paid_at: new Date().toISOString(),
        pay_by: input.method,
        collected_by: profile.id,
        collected_note: input.note?.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", invoice.id);
    if (updateError) return { ok: false, message: describeDbError(updateError) };

    await admin.from("job_messages").insert({
      job_id: invoice.job_id,
      organization_id: invoice.organization_id,
      channel: "internal",
      author_type: "team",
      author_name: collectorName,
      body: collectedThreadNote(input.method, input.amountCents, collectorName),
    });

    // Stripe's copy of the invoice stops chasing. Best effort: the money is
    // recorded here either way, and a Stripe hiccup is a log line.
    let stripeNote = "";
    if (invoice.stripe_invoice_id && isStripeConfigured) {
      try {
        await stripeClient().invoices.pay(invoice.stripe_invoice_id, { paid_out_of_band: true });
      } catch (err) {
        log.error("stripe.invoice.paid_out_of_band", { invoice: invoice.stripe_invoice_id, error: String(err) });
        stripeNote = " Stripe could not be told; its copy may still show open.";
      }
    }

    revalidateJobViews(invoice.job_id, contact.customerId);
    return { ok: true, message: `Recorded as paid by ${input.method}.${stripeNote}` };
  } catch (err) {
    log.error("mark_payment_collected", { error: String(err) });
    return { ok: false, message: "Couldn't record that." };
  }
}
