/**
 * Approved is not sent.
 *
 * The office approves a proposal; the client gets it when the email goes,
 * which is a separate moment now that the email waits on My Day. Every
 * screen that used to say "sent" the moment of approval reads these
 * instead, so the word matches what happened.
 */

/**
 * Whether the client has actually had it. Once they have answered, they
 * plainly did. Null means "approved, not sent"; a caller that does not
 * carry the column at all (undefined) is read the old way, sent on approval.
 */
export function wasSent(status: string | null | undefined, sentAt: string | null | undefined): boolean {
  if (status === "accepted" || status === "declined") return true;
  return status === "sent" && sentAt !== null;
}

/** The badge on the job's proposal panel. */
export function proposalStatusLabel(status: string, sentAt: string | null | undefined): string {
  switch (status) {
    case "needs_approval":
      return "Needs approval";
    case "sent":
      return sentAt === null ? "Approved — not sent yet" : "Sent — awaiting response";
    case "accepted":
      return "Accepted";
    case "declined":
      return "Declined";
    default:
      return status.replace(/_/g, " ");
  }
}

/** The short form on a client's page. */
export function proposalShortLabel(status: string, sentAt: string | null | undefined): string {
  switch (status) {
    case "needs_approval":
      return "Needs approval";
    case "sent":
      return sentAt === null ? "Proposal approved, not sent" : "Proposal sent";
    case "accepted":
      return "Proposal accepted";
    case "declined":
      return "Proposal declined";
    default:
      return status.replace(/_/g, " ");
  }
}

/** The tone of the badge: waiting on us is amber, waiting on them is blue. */
export function proposalStatusTone(status: string, sentAt: string | null | undefined): "amber" | "blue" | "good" | "bad" {
  if (status === "accepted") return "good";
  if (status === "declined") return "bad";
  if (status === "sent" && sentAt !== null) return "blue";
  return "amber";
}
