"use server";

import { getCurrentProfile } from "@/lib/data/team";
import { applyProposalTrim } from "@/lib/data/proposal-trim-apply";

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
 * The work itself lives in `applyProposalTrim`, which the evaluation panel
 * also reaches when an area is removed there; this is the door the trim
 * panel on the proposal comes through.
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

    const outcome = await applyProposalTrim({
      proposalId: input.proposalId,
      removeZones: input.removeZones,
      removeLines: input.removeLines,
      totalCents: input.totalCents,
      note: input.note,
      requestedVia: input.requestedVia,
      notifyClient: input.notifyClient,
      editedBy: { id: profile.id, name: profile.full_name || profile.email },
    });
    if (!outcome.ok) return { ok: false, message: outcome.message };
    return {
      ok: true,
      newTotalCents: outcome.newTotalCents,
      removedZones: outcome.removedZones,
      removedLines: outcome.removedLines,
      notified: outcome.notified,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Couldn't update that." };
  }
}
