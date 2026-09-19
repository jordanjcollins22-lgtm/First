/**
 * What closing a job does to its proposals, and what the client then reads.
 *
 * A decline is one fact with two records. The job carries it for the board
 * and the queues; the proposal carries it for the proposals list, the call
 * list and the client's page. When the office declined a job only the first
 * was written, and the second went on saying "sent" to everybody who read it.
 */

import { expiredWording, isExpired } from "@/lib/proposal-validity";
import type { ProposalStatus } from "@/types/domain";

/** The statuses a proposal can still be closed from. Accepted is a contract. */
export const OPEN_PROPOSAL_STATUSES: readonly ProposalStatus[] = ["needs_approval", "sent"];

export function isOpenProposal(status: string | null | undefined): status is "needs_approval" | "sent" {
  return status === "needs_approval" || status === "sent";
}

/**
 * What the client sees on a declined proposal.
 *
 * "You declined this" is only true when they pressed the button. When the
 * office closed it, after a call or on the board, the page says so without
 * putting words in their mouth.
 */
export function declinedWording(input: {
  closedByOffice: boolean;
  respondedAt: string | null;
  /** When it stopped standing, if it had a life. Run out before it was closed means it expired. */
  expiresAt?: string | null;
}): {
  headline: string;
  detail: string;
} {
  if (input.closedByOffice && input.expiresAt && isExpired(input.expiresAt, input.respondedAt ? new Date(input.respondedAt) : new Date())) {
    return expiredWording(input.expiresAt);
  }
  const on = input.respondedAt ? ` on ${new Date(input.respondedAt).toLocaleDateString()}` : "";
  if (input.closedByOffice) {
    return {
      headline: `This proposal was closed${on}.`,
      detail: "If you would like to pick it back up, message us and we will reopen it.",
    };
  }
  return {
    headline: `You declined this proposal${on}.`,
    detail: "Feel free to reach out if anything changes.",
  };
}
