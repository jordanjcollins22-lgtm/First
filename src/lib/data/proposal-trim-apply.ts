import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { revalidateJobViews } from "@/lib/revalidate-job";
import { proposalPath } from "@/lib/proposal-flow";
import { hasChange, trimProposal, trimSummary } from "@/lib/proposal-trim";
import { updateNoticeText, updateThreadNote, worthSending } from "@/lib/proposal-update-notice";
import { jobThreadContext } from "@/lib/message-context";
import { frozenForClient } from "@/lib/data/job-dispute";
import { sendSms, toE164 } from "@/lib/sms";
import type { ProposalZoneSnapshot } from "@/types/domain";

/**
 * Taking work off a proposal, wherever the request came from.
 *
 * Two doors lead here: the trim panel on the proposal, and an evaluation
 * edit that removed an area. They used to be one door. Removing an area
 * from the evaluation left the proposal as it was, and somebody had to
 * remember to go and trim it separately, so a client could be told "we've
 * taken that off" and open a proposal that still listed it. Both doors now
 * run the same code, record the same edit, and tell the client the same way.
 *
 * Not a server action. It is called by two of them, and an exported async
 * function in a "use server" file is an endpoint of its own; this is a
 * library function with the caller's profile handed in.
 */
export type TrimOutcome =
  | {
      ok: true;
      newTotalCents: number;
      removedZones: number;
      removedLines: number;
      /** Whether the client was actually told. False when nothing reached a
       * phone — no number on file, or the office chose not to send. */
      notified: boolean;
      status: string;
    }
  | { ok: false; reason: "accepted" | "missing" | "nothing" | "failed"; message: string };

export async function applyProposalTrim(input: {
  /** One or the other. By job when the caller only knows the job. */
  proposalId?: string;
  jobId?: string;
  removeZones: string[];
  removeLines: { zoneName: string; line: string }[];
  /** What the office decided the price should be, in cents. Defaults to the
   * arithmetic, but a person can overrule it — a hand-priced area or a
   * discount means the subtraction is a suggestion, not an answer. */
  totalCents?: number;
  note?: string;
  /** How the client asked: "text", "call", "in_person", or "office". */
  requestedVia?: string;
  /** Tell the client it changed. */
  notifyClient?: boolean;
  /**
   * Only count when something actually came off. The evaluation panel sends
   * its own note along, and a note about the evaluation must not become a
   * proposal edit that removed nothing.
   */
  requireRemoval?: boolean;
  editedBy: { id: string; name: string };
}): Promise<TrimOutcome> {
  const supabase = await createClient();
  let query = supabase.from("job_proposals").select("id, job_id, token, status, total_cost, scope_snapshot");
  query = input.proposalId ? query.eq("id", input.proposalId) : query.eq("job_id", input.jobId ?? "");
  const { data: proposal, error } = await query.maybeSingle();
  if (error) return { ok: false, reason: "failed", message: error.message };
  if (!proposal) return { ok: false, reason: "missing", message: "Couldn't find that proposal." };
  if (proposal.status === "accepted") {
    return {
      ok: false,
      reason: "accepted",
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

  if (input.requireRemoval && result.empty) {
    return { ok: false, reason: "nothing", message: "None of those areas are on the proposal." };
  }

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
    return {
      ok: false,
      reason: "nothing",
      message: "Nothing to save yet — remove something, change the price, or write a note.",
    };
  }

  const organizationId = await getCurrentOrganizationId();
  const { error: logError } = await supabase.from("proposal_edits").insert({
    proposal_id: proposal.id,
    organization_id: organizationId,
    edited_by: input.editedBy.id,
    edited_by_name: input.editedBy.name,
    removed_zones: result.removedZones,
    removed_lines: result.removedLines,
    previous_total_cents: statedTotalCents,
    new_total_cents: newTotalCents,
    note: input.note?.trim() || null,
    requested_via: input.requestedVia || null,
  });
  // Recorded first, on purpose. A trim nobody can account for later is
  // worse than a trim that did not happen.
  if (logError) return { ok: false, reason: "failed", message: logError.message };

  const { error: updateError } = await supabase
    .from("job_proposals")
    .update({ scope_snapshot: result.zones, total_cost: newTotalCents / 100 })
    .eq("id", proposal.id);
  if (updateError) return { ok: false, reason: "failed", message: updateError.message };

  // The client's own page, so a refresh on the link they already have
  // shows the shorter proposal rather than a cached copy of the old one.
  revalidatePath(proposalPath(proposal.token));
  revalidateJobViews(proposal.job_id);

  // Approved and sent, rather than saved quietly. The link does not change,
  // so without this the client finds out the next time they happen to open
  // it — or at the door.
  const changes = [trimSummary({ removedZones: result.removedZones, removedLines: result.removedLines })].filter(
    (line) => line !== "Nothing removed"
  );
  // A draft nobody has seen has nobody to tell. Only a sent proposal has a
  // client holding a link that just changed under them.
  let notified = false;
  const seen = proposal.status === "sent";
  if (input.notifyClient && seen && worthSending({ changes, previousTotalCents: statedTotalCents, newTotalCents })) {
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
    status: proposal.status,
  };
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
