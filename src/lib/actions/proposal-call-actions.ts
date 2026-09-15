"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { revalidateJobViews } from "@/lib/revalidate-job";
import { defaultCallbackOn, isCallOutcome, OUTCOME_LABEL } from "@/lib/call-list";

export type CallResult = { ok: true; message: string } | { ok: false; message: string };

/**
 * What the client said, recorded in one tap.
 *
 * The row is the record; the side effects are what the words mean. "Went
 * with someone else" and "asked us not to call" close the job as declined,
 * so it leaves every list at once rather than reappearing on Monday. A
 * client nobody had claimed becomes this person's, because whoever rang is
 * whoever is working it.
 */
export async function recordProposalCall(input: {
  proposalId: string;
  outcome: string;
  note: string;
  callbackOn?: string | null;
}): Promise<CallResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };
    if (!isCallOutcome(input.outcome)) return { ok: false, message: "Pick what they said." };

    const supabase = await createClient();
    const organizationId = await getCurrentOrganizationId();

    const { data: proposal, error } = await supabase
      .from("job_proposals")
      .select("id, job_id, status, job:jobs(property:properties(customer_id, customer:customers(id, account_manager_id)))")
      .eq("id", input.proposalId)
      .maybeSingle();
    if (error) return { ok: false, message: error.message };
    if (!proposal) return { ok: false, message: "Couldn't find that proposal." };

    const job = proposal.job as unknown as {
      property: { customer_id: string | null; customer: { id: string; account_manager_id: string | null } | null } | null;
    } | null;
    const customer = job?.property?.customer ?? null;

    const callbackOn =
      (input.callbackOn && /^\d{4}-\d{2}-\d{2}$/.test(input.callbackOn) ? input.callbackOn : null) ??
      defaultCallbackOn(input.outcome);

    const { error: insertError } = await supabase.from("proposal_calls").insert({
      organization_id: organizationId,
      proposal_id: proposal.id,
      job_id: proposal.job_id,
      customer_id: customer?.id ?? null,
      profile_id: profile.id,
      outcome: input.outcome,
      note: input.note.trim().slice(0, 1000) || null,
      callback_on: callbackOn,
    });
    if (insertError) return { ok: false, message: insertError.message };

    // Whoever rang is whoever is working it.
    if (customer && !customer.account_manager_id) {
      await supabase.from("customers").update({ account_manager_id: profile.id }).eq("id", customer.id);
    }

    const now = new Date().toISOString();
    if (input.outcome === "went_elsewhere" || input.outcome === "do_not_call") {
      await supabase
        .from("jobs")
        .update({
          declined_at: now,
          declined_by: profile.id,
          declined_reason: input.note.trim() || OUTCOME_LABEL[input.outcome],
        })
        .eq("id", proposal.job_id);
      if (proposal.status === "sent") {
        await supabase.from("job_proposals").update({ status: "declined", responded_at: now }).eq("id", proposal.id);
      }
    }
    if (input.outcome === "do_not_call" && customer) {
      await supabase.from("customers").update({ do_not_contact: true }).eq("id", customer.id);
    }

    revalidatePath("/my-day");
    revalidatePath("/proposals");
    revalidateJobViews(proposal.job_id, customer?.id ?? null);

    const said = OUTCOME_LABEL[input.outcome];
    if (callbackOn && (input.outcome === "no_answer" || input.outcome === "call_back" || input.outcome === "next_season")) {
      return { ok: true, message: `${said}. Back on your list ${callbackOn}.` };
    }
    if (input.outcome === "went_elsewhere" || input.outcome === "do_not_call") {
      return { ok: true, message: `${said}. The job is marked declined and off your list.` };
    }
    if (input.outcome === "said_yes") {
      return { ok: true, message: "Great. Text them their link so they can tap Accept and pick a day." };
    }
    return { ok: true, message: `${said}. Recorded.` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Couldn't save that." };
  }
}
