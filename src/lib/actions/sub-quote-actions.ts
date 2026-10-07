"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { outboundBaseUrl } from "@/lib/base-url";
import { quoteLink } from "@/lib/data/sub-quotes";
import { isQuoteToken, parseMoney, quoteToken, serviceGroups } from "@/lib/sub-quotes";
import { notifyTeamMember } from "@/lib/notifications";
import { describeDbError } from "@/lib/setup-errors";
import type { ProposalZoneSnapshot } from "@/types/domain";

export type SubQuoteResult<T = object> = ({ ok: true } & T) | { ok: false; message: string };

/**
 * Makes the link for one service on a job.
 *
 * The areas are copied off the proposal as it stands, so the contractor
 * prices what they were shown even if the office reworks a zone tomorrow.
 */
export async function createSubQuoteRequest(input: { jobId: string; serviceLabel: string; note?: string }): Promise<SubQuoteResult<{ token: string; link: string }>> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };

    const supabase = await createClient();
    const { data: proposal } = await supabase
      .from("job_proposals")
      .select("organization_id, scope_snapshot")
      .eq("job_id", input.jobId)
      .maybeSingle();
    if (!proposal) return { ok: false, message: "Build the proposal first. The request is written from it." };

    const group = serviceGroups((proposal.scope_snapshot ?? []) as unknown as ProposalZoneSnapshot[]).find(
      (g) => g.serviceLabel === input.serviceLabel
    );
    if (!group) return { ok: false, message: "That service isn't on the proposal any more." };

    const token = quoteToken();
    const { error } = await supabase.from("sub_quote_requests").insert({
      organization_id: proposal.organization_id,
      job_id: input.jobId,
      token,
      service_label: group.serviceLabel,
      areas: group.areas,
      note: input.note?.trim() || null,
      created_by: profile.id,
    });
    if (error) return { ok: false, message: describeDbError(error) };

    revalidatePath(`/jobs/${input.jobId}`);
    return { ok: true, token, link: quoteLink(await outboundBaseUrl(), token) };
  } catch (err) {
    console.error("createSubQuoteRequest failed:", err);
    return { ok: false, message: "Couldn't make that link." };
  }
}

/** Stops the link taking a price. The page still opens and says so. */
export async function closeSubQuoteRequest(id: string): Promise<SubQuoteResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Sign in first." };
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("sub_quote_requests")
      .update({ status: "closed", updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("job_id")
      .maybeSingle();
    if (error) return { ok: false, message: describeDbError(error) };
    if (data) revalidatePath(`/jobs/${data.job_id}`);
    return { ok: true };
  } catch (err) {
    console.error("closeSubQuoteRequest failed:", err);
    return { ok: false, message: "Couldn't close that." };
  }
}

/**
 * The contractor's price, from the public page.
 *
 * Service role, because the sender has no account. The token is the
 * authorisation. A second submission on the same link replaces the first:
 * a contractor who rethinks a number should not need a new link.
 */
export async function submitSubQuote(input: {
  token: string;
  name: string;
  phone: string;
  email: string;
  amount: string;
  note: string;
}): Promise<SubQuoteResult> {
  try {
    if (!isQuoteToken(input.token)) return { ok: false, message: "That link is not right." };
    const name = input.name.trim().slice(0, 120);
    if (!name) return { ok: false, message: "Tell us who is quoting." };
    const amount = parseMoney(input.amount);
    if (amount == null) return { ok: false, message: "Enter the price as a number." };
    const phone = input.phone.trim().slice(0, 40) || null;
    const email = input.email.trim().slice(0, 200) || null;
    if (!phone && !email) return { ok: false, message: "Leave a phone number or an email so we can reach you." };

    const admin = createAdminClient();
    const { data: request } = await admin
      .from("sub_quote_requests")
      .select("id, job_id, organization_id, service_label, status")
      .eq("token", input.token)
      .maybeSingle();
    if (!request) return { ok: false, message: "That link has expired or was never ours." };
    if (request.status === "closed") return { ok: false, message: "This request is closed. Thanks anyway." };

    const now = new Date().toISOString();
    const { error } = await admin
      .from("sub_quote_requests")
      .update({
        status: "quoted",
        contractor_name: name,
        contractor_phone: phone,
        contractor_email: email,
        quote_amount: amount,
        quote_note: input.note.trim().slice(0, 1000) || null,
        quoted_at: now,
        updated_at: now,
      })
      .eq("id", request.id);
    if (error) return { ok: false, message: "Could not save that. Try again in a moment." };

    const money = amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
    const line = `${name} quoted ${money} for ${request.service_label}${phone ? ` (${phone})` : ""}${email ? ` ${email}` : ""}.${input.note.trim() ? ` "${input.note.trim().slice(0, 300)}"` : ""}`;

    // On the job for whoever opens it, and a text to the account manager,
    // because a price that sits unread is a job that sits unsold.
    await admin.from("job_messages").insert({
      job_id: request.job_id,
      organization_id: request.organization_id,
      channel: "internal",
      author_type: "team",
      author_name: "Subcontractor price",
      body: line,
    });
    const { data: job } = await admin
      .from("jobs")
      .select("property:properties(address, customer:customers(account_manager_id))")
      .eq("id", request.job_id)
      .maybeSingle();
    const managerId = (job as unknown as { property?: { address?: string; customer?: { account_manager_id: string | null } | null } | null } | null)?.property?.customer?.account_manager_id ?? null;
    if (managerId) {
      await notifyTeamMember(managerId, "team_messages", `Price in: ${line}`, { dedupeKey: `sub-quote:${request.id}:${now}` }).catch(() => false);
    }

    revalidatePath(`/jobs/${request.job_id}`);
    return { ok: true };
  } catch (err) {
    console.error("submitSubQuote failed:", err);
    return { ok: false, message: "Could not save that. Try again in a moment." };
  }
}
