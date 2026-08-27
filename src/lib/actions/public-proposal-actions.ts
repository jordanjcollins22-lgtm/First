"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { createAndSendInvoice } from "@/lib/invoicing";
import { notifyJobTeam } from "@/lib/notifications";
import { reduceScope, type ScopeLine } from "@/lib/objections";
import type { ProposalZoneSnapshot } from "@/types/domain";

/**
 * The client's Accept/Decline click — no logged-in user exists, so this runs
 * entirely on the service-role client (same pattern as /book). Accepting
 * moves the underlying job to "approved" directly and sends the invoice;
 * nothing else touches that transition today, so this is the one real
 * conversion action.
 */
export async function respondToProposal(token: string, response: "accepted" | "declined", note: string) {
  if (response !== "accepted" && response !== "declined") throw new Error("Invalid response.");

  const admin = createAdminClient();
  const { data: proposal, error } = await admin
    .from("job_proposals")
    .select("id, job_id, status, total_cost, discount_amount")
    .eq("token", token)
    .maybeSingle();
  if (error) throw error;
  if (!proposal) throw new Error("This proposal link isn't valid.");
  if (proposal.status === "needs_approval") throw new Error("This proposal isn't ready yet — check back soon.");
  if (proposal.status !== "sent") throw new Error("This proposal has already been responded to.");

  const { error: updateError } = await admin
    .from("job_proposals")
    .update({
      status: response,
      responded_at: new Date().toISOString(),
      client_response_note: note.trim() || null,
    })
    .eq("id", proposal.id);
  if (updateError) throw updateError;

  notifyJobTeam(
    proposal.job_id,
    "proposal_responses",
    `A client ${response} their proposal.`,
    { dedupeKey: proposal.id }
  ).catch(() => {
    // Best-effort — the client's response is already recorded.
  });

  if (response === "accepted") {
    const { error: jobError } = await admin.from("jobs").update({ status: "approved" }).eq("id", proposal.job_id);
    if (jobError) throw jobError;

    const amountDue = Math.max(0, Math.round((proposal.total_cost ?? 0) - proposal.discount_amount));
    createAndSendInvoice(proposal.job_id, proposal.id, amountDue).catch(() => {
      // Best-effort — the acceptance itself already succeeded either way.
    });
  }

  revalidatePath(`/jobs/${proposal.job_id}`);
  revalidatePath("/proposals");
}

// ---------------------------------------------------------------------------
// Questions from the client, before they decide
// ---------------------------------------------------------------------------

/** Results rather than throws — a thrown Server Action loses its message in
 * production and surfaces to a client as an unexplained crash, on the one
 * page where that costs a job. */
export type PublicResult<T = Record<string, never>> =
  | ({ ok: true } & T)
  | { ok: false; message: string };

function describe(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: string }).message);
  }
  return "Something went wrong. Please try again.";
}

/** The proposal behind a link, or null. Never leaks why it failed. */
async function proposalForToken(token: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("job_proposals")
    .select("id, job_id, organization_id, status, total_cost, discount_amount, scope_snapshot")
    .eq("token", token)
    .maybeSingle();
  return data;
}

/**
 * Record that a client tapped a question, and whether our answer settled it.
 *
 * Called twice for one objection: once when they open it, and again with
 * `resolved` once they say whether it helped. Two rows would double-count the
 * objection and halve the apparent answer rate, so the second call updates
 * the first.
 */
export async function recordObjection(input: {
  token: string;
  objectionId: string;
  resolution?: "explain" | "payment_plan" | "reduce_scope" | "talk" | null;
  resolved?: boolean | null;
  note?: string | null;
}): Promise<PublicResult<{ id: string }>> {
  try {
    const proposal = await proposalForToken(input.token);
    if (!proposal) return { ok: false, message: "This proposal link isn't valid." };

    const admin = createAdminClient();
    const note = input.note?.trim() || null;

    // The open-then-answer pair. Matched on the most recent unanswered row for
    // this objection so a client who opens the same question twice in one
    // sitting does not leave a half-finished row behind.
    const { data: open } = await admin
      .from("proposal_objections")
      .select("id")
      .eq("proposal_id", proposal.id)
      .eq("objection_id", input.objectionId)
      .is("resolved", null)
      .order("raised_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (open?.id) {
      const { error } = await admin
        .from("proposal_objections")
        .update({
          resolution: input.resolution ?? null,
          resolved: input.resolved ?? null,
          note,
        })
        .eq("id", open.id);
      if (error) return { ok: false, message: describe(error) };
      return { ok: true, id: open.id };
    }

    const { data: created, error } = await admin
      .from("proposal_objections")
      .insert({
        organization_id: proposal.organization_id,
        proposal_id: proposal.id,
        objection_id: input.objectionId,
        resolution: input.resolution ?? null,
        resolved: input.resolved ?? null,
        note,
      })
      .select("id")
      .single();
    if (error || !created) return { ok: false, message: describe(error) };

    // Worth waking somebody for only when we failed to answer it. A client
    // reading the stock answer and moving on is not news.
    if (input.resolved === false || note) {
      notifyJobTeam(
        proposal.job_id,
        "proposal_responses",
        "A client has a question we couldn't answer on their proposal.",
        { dedupeKey: `${proposal.id}:${input.objectionId}` }
      ).catch(() => {});
    }

    return { ok: true, id: created.id };
  } catch (err) {
    return { ok: false, message: describe(err) };
  }
}

/**
 * A client asking to keep only part of the work.
 *
 * Re-prices where every line came off the rate card, and refers to a person
 * where it did not — a hand-entered price, an agreed discount, or a line we
 * never captured a price for. The client is told which happened, because a
 * quote whose number moves on its own is worse than one that takes a day.
 */
export async function requestScopeChange(input: {
  token: string;
  keepZones: string[];
}): Promise<PublicResult<{ applied: boolean; newTotalCents: number | null; reviewReason: string | null }>> {
  try {
    const proposal = await proposalForToken(input.token);
    if (!proposal) return { ok: false, message: "This proposal link isn't valid." };
    if (proposal.status !== "sent") {
      return { ok: false, message: "This proposal has already been responded to." };
    }

    const snapshot = (proposal.scope_snapshot ?? []) as unknown as ProposalZoneSnapshot[];
    const lines: ScopeLine[] = snapshot.map((z) => ({
      zoneName: z.zoneName,
      serviceLabel: z.serviceLabel,
      priceCents: z.priceCents ?? null,
      priceDerived: z.priceDerived ?? false,
    }));

    const statedTotalCents = Math.round((proposal.total_cost ?? 0) * 100);
    const discountCents = Math.round((proposal.discount_amount ?? 0) * 100);
    const change = reduceScope(lines, input.keepZones, { discountCents, statedTotalCents });

    if (change.droppedNames.length === 0) {
      return { ok: false, message: "Nothing was removed — pick the areas you'd like to keep." };
    }
    if (change.keptNames.length === 0) {
      return { ok: false, message: change.reviewReason ?? "Keep at least one area." };
    }

    const admin = createAdminClient();
    const { error } = await admin.from("proposal_scope_requests").insert({
      organization_id: proposal.organization_id,
      proposal_id: proposal.id,
      kept_zones: change.keptNames,
      dropped_zones: change.droppedNames,
      previous_total_cents: statedTotalCents,
      new_total_cents: change.newTotalCents,
      status: change.auto ? "applied" : "needs_review",
      review_reason: change.reviewReason,
    });
    if (error) return { ok: false, message: describe(error) };

    // Only rewrite the proposal when the price stood on its own. Trimming the
    // scope without a price behind it would leave the client looking at work
    // they did not agree to at a number nobody calculated.
    if (change.auto && change.newTotalCents != null) {
      const keep = new Set(change.keptNames);
      const { error: updateError } = await admin
        .from("job_proposals")
        .update({
          total_cost: change.newTotalCents / 100,
          scope_snapshot: snapshot.filter((z) => keep.has(z.zoneName)),
        })
        .eq("id", proposal.id);
      if (updateError) return { ok: false, message: describe(updateError) };
    }

    notifyJobTeam(
      proposal.job_id,
      "proposal_responses",
      change.auto
        ? "A client trimmed their proposal — the price updated automatically."
        : "A client asked to change their proposal scope. Needs a new price.",
      { dedupeKey: `${proposal.id}:scope` }
    ).catch(() => {});

    revalidatePath(`/jobs/${proposal.job_id}`);
    revalidatePath("/proposals");

    return {
      ok: true,
      applied: change.auto,
      newTotalCents: change.newTotalCents,
      reviewReason: change.reviewReason,
    };
  } catch (err) {
    return { ok: false, message: describe(err) };
  }
}
