"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { revalidateJobViews } from "@/lib/revalidate-job";
import { proposalPath } from "@/lib/proposal-flow";
import { hasChange, trimProposal, trimSummary } from "@/lib/proposal-trim";
import { updateNoticeText, updateThreadNote, worthSending } from "@/lib/proposal-update-notice";
import { jobThreadContext } from "@/lib/message-context";
import { frozenForClient } from "@/lib/data/job-dispute";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendSms, toE164 } from "@/lib/sms";
import type { ProposalZoneSnapshot } from "@/types/domain";

export type TrimResponse =
  | {
      ok: true;
      newTotalCents: number;
      removedZones: number;
      removedLines: number;
      /** Whether the client was actually told. False when nothing reached a
       * phone — no number on file, or the office chose not to send. */
      notified: boolean;
    }
  | { ok: false; message: string };

/**
 * Taking work off a proposal the client already has.
 *
 * Writes over the same row, which means the same token and the same link:
 * the client refreshes and sees the shorter version, with nothing to
 * re-send and no second URL for them to have the wrong one of.
 *
 * The removal is recorded before the proposal is rewritten. If the record
 * fails we do not trim, because a proposal that quietly lost an area is
 * exactly the situation this table exists to prevent.
 */
export async function trimSentProposal(input: {
  proposalId: string;
  removeZones: string[];
  removeLines: { zoneName: string; line: string }[];
  /** What the office decided the price should be, in cents. Defaults to the
   * arithmetic, but a person can overrule it — a hand-priced area or a
   * discount means the subtraction is a suggestion, not an answer. */
  totalCents?: number;
  note?: string;
  /** How the client asked: "text", "call", "in_person", or "office" when it
   * was our own decision. Most changes arrive as a text message rather than
   * through the buttons on the proposal. */
  requestedVia?: string;
  /** Tell the client it changed. On by default from the panel: a price that
   * moved on a page nobody is looking at is a price they find out about at
   * the door. Off for a typo nobody needs texting about. */
  notifyClient?: boolean;
}): Promise<TrimResponse> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Not signed in." };

    const supabase = await createClient();
    const { data: proposal, error } = await supabase
      .from("job_proposals")
      .select("id, job_id, token, status, total_cost, scope_snapshot")
      .eq("id", input.proposalId)
      .maybeSingle();
    if (error) return { ok: false, message: error.message };
    if (!proposal) return { ok: false, message: "Couldn't find that proposal." };
    if (proposal.status === "accepted") {
      return {
        ok: false,
        message: "This one is already accepted. Changing it now would move a price they agreed to.",
      };
    }

    const zones = (proposal.scope_snapshot ?? []) as unknown as ProposalZoneSnapshot[];
    const statedTotalCents = Math.round((proposal.total_cost ?? 0) * 100);

    const result = trimProposal({
      zones,
      removeZones: input.removeZones,
      removeLines: input.removeLines,
      statedTotalCents,
    });
    const newTotalCents = Math.max(0, Math.round(input.totalCents ?? result.newTotalCents));

    // Not only removals. A client who texts "can you add the stone edging"
    // ends with a price that moved and nothing taken off, and a note on its
    // own is worth recording too — the alternative is somebody editing a
    // price with nothing saying why.
    if (
      !hasChange({
        removedZones: result.removedZones,
        removedLines: result.removedLines,
        statedTotalCents,
        newTotalCents,
        note: input.note,
      })
    ) {
      return { ok: false, message: "Nothing to save yet — remove something, change the price, or write a note." };
    }

    const organizationId = await getCurrentOrganizationId();
    const { error: logError } = await supabase.from("proposal_edits").insert({
      proposal_id: proposal.id,
      organization_id: organizationId,
      edited_by: profile.id,
      edited_by_name: profile.full_name || profile.email,
      removed_zones: result.removedZones,
      removed_lines: result.removedLines,
      previous_total_cents: statedTotalCents,
      new_total_cents: newTotalCents,
      note: input.note?.trim() || null,
      requested_via: input.requestedVia || null,
    });
    // Recorded first, on purpose. A trim nobody can account for later is
    // worse than a trim that did not happen.
    if (logError) return { ok: false, message: logError.message };

    const { error: updateError } = await supabase
      .from("job_proposals")
      .update({ scope_snapshot: result.zones, total_cost: newTotalCents / 100 })
      .eq("id", proposal.id);
    if (updateError) return { ok: false, message: updateError.message };

    // The client's own page, so a refresh on the link they already have
    // shows the shorter proposal rather than a cached copy of the old one.
    revalidatePath(proposalPath(proposal.token));
    revalidateJobViews(proposal.job_id);

    // Approved and sent, rather than saved quietly. The link does not change,
    // so without this the client finds out the next time they happen to open
    // it — or at the door.
    const changes = [
      trimSummary({ removedZones: result.removedZones, removedLines: result.removedLines }),
    ].filter((line) => line !== "Nothing removed");
    let notified = false;
    if (input.notifyClient && worthSending({ changes, previousTotalCents: statedTotalCents, newTotalCents })) {
      notified = await tellClient({
        jobId: proposal.job_id,
        organizationId,
        changes,
        previousTotalCents: statedTotalCents,
        newTotalCents,
      }).catch(() => false);
    }

    return {
      ok: true,
      newTotalCents,
      removedZones: result.removedZones.length,
      removedLines: result.removedLines.length,
      notified,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Couldn't update that." };
  }
}

/**
 * Texts the client that their proposal moved, and leaves the same words on
 * the job's thread so the office can see what they were told.
 *
 * Best-effort in both directions: the change is already saved and live on
 * their link, and a text that failed is not a reason to tell somebody their
 * update did not go through.
 */
async function tellClient(input: {
  jobId: string;
  organizationId: string;
  changes: string[];
  previousTotalCents: number;
  newTotalCents: number;
}): Promise<boolean> {
  const context = await jobThreadContext(input.jobId);
  if (!context) return false;

  // Same freeze as every other outbound path. The office can still tell them
  // by hand; the app will not do it on its own while a dispute is open.
  if (await frozenForClient(input.jobId)) return false;

  const notice = updateNoticeText({
    businessName: context.businessName,
    changes: input.changes,
    previousTotalCents: input.previousTotalCents,
    newTotalCents: input.newTotalCents,
    link: context.clientLink,
  });

  const admin = createAdminClient();
  await admin.from("job_messages").insert({
    job_id: input.jobId,
    organization_id: input.organizationId,
    channel: "external",
    author_type: "team",
    author_name: context.businessName || "Office",
    body: updateThreadNote({
      businessName: context.businessName,
      changes: input.changes,
      previousTotalCents: input.previousTotalCents,
      newTotalCents: input.newTotalCents,
    }),
    reference_label: "Their proposal",
    reference_kind: "proposal",
  });

  const e164 = context.clientPhone ? toE164(context.clientPhone) : null;
  if (!e164) return false;
  await sendSms(e164, notice);
  return true;
}
