/**
 * Closing a proposal the client never answered: the account manager says
 * Yes (we won it) or No (we lost it), and why. A reason is required, so a
 * closed proposal always says what happened.
 */

export type CloseOutcome = "won" | "lost";

/** Shortest reason that counts: a word or two, not a single letter. */
export const MIN_REASON = 3;

/** The error to show, or null when the answer can be saved. */
export function closeBlocker(outcome: unknown, reason: unknown): string | null {
  if (outcome !== "won" && outcome !== "lost") return "Pick Yes or No first.";
  const why = typeof reason === "string" ? reason.trim() : "";
  if (why.length < MIN_REASON)
    return outcome === "won" ? "Say why they said yes." : "Say why we lost it.";
  return null;
}

/**
 * What the proposal row becomes. Won is accepted, lost is declined, both
 * marked as the office's answer rather than the client's tap. Lost keeps
 * office_declined_from, the same mark the board uses, so the win-back
 * automation leaves it alone and the decline can be taken back.
 */
export function closeUpdate(
  outcome: CloseOutcome,
  reason: string,
  by: string,
  now: Date,
) {
  const at = now.toISOString();
  const base = {
    responded_at: at,
    close_reason: reason.trim(),
    closed_by: by,
    closed_at: at,
  };
  return outcome === "won"
    ? { ...base, status: "accepted" as const }
    : {
        ...base,
        status: "declined" as const,
        office_declined_by: by,
        office_declined_from: "sent" as const,
      };
}

/** "Sent 12 days ago", the age that makes a proposal worth closing. */
export function sentAgo(sentAt: string | null, now: Date): string {
  if (!sentAt) return "Not sent yet";
  const days = Math.floor(
    (now.getTime() - new Date(sentAt).getTime()) / 86_400_000,
  );
  if (days <= 0) return "Sent today";
  if (days === 1) return "Sent yesterday";
  return `Sent ${days} days ago`;
}

/** The part of a job name after the address: "Leaf removal", "Evaluation". */
export function workOf(jobName: string): string {
  const parts = jobName
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : jobName;
}

/** A follow-up's note once it is done: what it said, then what happened and when. */
export function followUpNote(before: string | null | undefined, happened: string, now: Date): string {
  const day = now.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
  const line = `Done ${day}: ${happened.trim()}`;
  return before?.trim() ? `${before.trim()}\n\n${line}` : line;
}
