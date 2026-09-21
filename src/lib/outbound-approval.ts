/**
 * An automatic email, held until a person has read it.
 *
 * The machine writes well enough to send, and not well enough to send
 * unread. Somebody who has just spent a week on a proposal does not want the
 * follow-up going out the morning the client rang to say yes. So when the
 * business asks for it, every email the app writes on its own is parked,
 * the owner is told, and it goes when they say.
 *
 * What is here is the wording and the clock. Nothing here sends.
 */

export type ApprovalSource = "evaluation_sequence" | "client_reminder" | "team_request";

export const SOURCE_LABEL: Record<ApprovalSource, string> = {
  evaluation_sequence: "Evaluation email",
  client_reminder: "Reminder",
  team_request: "Team request",
};

/** What each one is, in the words the list shows. */
export function whatLabel(kind: string): string {
  switch (kind) {
    case "evaluation_booked":
    case "evaluation_confirmed":
      return "Booking confirmation";
    case "evaluation_two_days":
      return "Two days before the visit";
    case "evaluation_day_before":
    case "evaluation_reminder":
      return "Day before the visit";
    case "evaluation_morning_of":
      return "Morning of the visit";
    case "evaluation_after":
      return "After the visit";
    case "proposal_follow_up":
      return "Proposal follow-up";
    case "job_start_reminder":
      return "Job start reminder";
    case "invoice_reminder":
      return "Invoice reminder";
    case "measurements_request":
      return "Measurements request";
    case "proposal_ready":
      return "Proposal to the client";
    default:
      return kind.replace(/_/g, " ");
  }
}

const HOUR = 60 * 60 * 1000;

/**
 * How long an email stays worth sending.
 *
 * A "see you tomorrow" approved after the visit is worse than nothing, and
 * a booking confirmation three days late reads as a booking nobody noticed.
 * Each kind gets a window, and after it the row is closed unsent.
 */
export function staleAfter(kind: string, now: Date): Date {
  const hours = (() => {
    switch (kind) {
      case "evaluation_morning_of":
        return 3;
      case "evaluation_day_before":
      case "evaluation_reminder":
      case "job_start_reminder":
        return 12;
      case "evaluation_two_days":
      case "evaluation_after":
        return 24;
      case "evaluation_booked":
      case "evaluation_confirmed":
      case "proposal_follow_up":
        return 72;
      case "invoice_reminder":
      case "measurements_request":
        return 24 * 7;
      case "proposal_ready":
        return 24 * 14;
      default:
        return 48;
    }
  })();
  return new Date(now.getTime() + hours * HOUR);
}

export function isStale(expiresAt: string | Date | null | undefined, now: Date): boolean {
  if (!expiresAt) return false;
  const at = typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt;
  return at.getTime() <= now.getTime();
}

/** "Goes stale in 3 hours", for the row. */
export function staleLine(expiresAt: string | Date | null | undefined, now: Date): string | null {
  if (!expiresAt) return null;
  const at = typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt;
  const left = at.getTime() - now.getTime();
  if (left <= 0) return "Too late to send";
  const hours = Math.round(left / HOUR);
  if (hours < 1) return "Goes stale within the hour";
  if (hours < 24) return `Goes stale in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `Goes stale in ${days} day${days === 1 ? "" : "s"}`;
}

export function waitingLine(count: number): string {
  if (count === 1) return "1 email is waiting for your OK";
  return `${count} emails are waiting for your OK`;
}

/** The note that tells the owner something is waiting. */
export function digest(input: {
  items: { toName: string | null; toEmail: string; kind: string; expiresAt: string | null }[];
  link: string;
  now: Date;
}): { subject: string; text: string } {
  const count = input.items.length;
  const subject = waitingLine(count);
  const lines = input.items.slice(0, 10).map((item) => {
    const who = item.toName?.trim() || item.toEmail;
    const stale = staleLine(item.expiresAt, input.now);
    return `- ${whatLabel(item.kind)} to ${who}${stale ? ` (${stale.toLowerCase()})` : ""}`;
  });
  if (count > 10) lines.push(`- and ${count - 10} more`);
  const text = [
    `${subject}. Nothing goes to a client until you approve it.`,
    lines.join("\n"),
    `Read and approve them here: ${input.link}`,
  ].join("\n\n");
  return { subject, text };
}
