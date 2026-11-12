/**
 * Approve or deny a social post: which posts take which button, what a
 * denial writes, and what undoing one writes. Pure, so the rules are tested
 * and the server actions only do what they say.
 *
 * A denied post sits at 'denied', a status the posting job never picks up
 * (it only sends 'scheduled' and slots 'approved'), with an optional short
 * reason. Undo puts it back to 'draft' with no time, waiting for a yes.
 */

/** The statuses the posting job reads; a denied post is never one of them. */
export const POSTING_STATUSES = ["scheduled", "approved"] as const;

/** Longest reason kept: a few words for the record, not an essay. */
export const DENY_REASON_MAX = 200;

/** Posts that can still be approved: waiting for a yes. */
export function canApprove(status: string): boolean {
  return status === "draft";
}

/** Posts that can be denied: anything not out yet and not already denied. */
export const DENIABLE_STATUSES = ["draft", "approved", "scheduled"] as const;

export function canDeny(status: string): boolean {
  return (DENIABLE_STATUSES as readonly string[]).includes(status);
}

export function canUndoDeny(status: string): boolean {
  return status === "denied";
}

/** One line, trimmed, at most DENY_REASON_MAX characters; empty is no reason. */
export function tidyDenyReason(reason: string | null | undefined): string | null {
  const line = (reason ?? "").replace(/\s+/g, " ").trim();
  if (!line) return null;
  return line.length > DENY_REASON_MAX ? `${line.slice(0, DENY_REASON_MAX - 1).trimEnd()}…` : line;
}

/** The row change for a denial: off the schedule, approval cleared, reason kept. */
export function denyUpdate(input: { reason?: string | null; userId: string; now: Date }) {
  const at = input.now.toISOString();
  return {
    status: "denied" as const,
    scheduled_for: null,
    next_attempt_at: null,
    approved_by: null,
    approved_at: null,
    denied_reason: tidyDenyReason(input.reason),
    denied_by: input.userId,
    denied_at: at,
    updated_at: at,
  };
}

/** The row change for undoing a denial: a plain draft again. */
export function undoDenyUpdate(now: Date) {
  const at = now.toISOString();
  return {
    status: "draft" as const,
    scheduled_for: null,
    denied_reason: null,
    denied_by: null,
    denied_at: null,
    updated_at: at,
  };
}

/** Whether an error from a deny means migration 0374 is not in yet. */
export function isDenyNotReady(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  // 23514: the old status check refuses 'denied'. 42703 / PGRST204: no denied_* columns.
  if (error.code === "23514" || error.code === "42703" || error.code === "PGRST204") return true;
  return /social_posts_status_check|denied_(reason|by|at)/i.test(error.message ?? "");
}

/** The preview page's local decisions: card number to verdict. Nothing is saved. */
export type Verdict = "approved" | "denied";
export type Decisions = Record<number, Verdict>;

/** Press a button: the same verdict again takes it back off. */
export function decide(decisions: Decisions, card: number, verdict: Verdict): Decisions {
  const next = { ...decisions };
  if (next[card] === verdict) delete next[card];
  else next[card] = verdict;
  return next;
}

export function countDecisions(decisions: Decisions, total: number) {
  const values = Object.values(decisions);
  const approved = values.filter((v) => v === "approved").length;
  const denied = values.filter((v) => v === "denied").length;
  return { approved, denied, undecided: Math.max(0, total - approved - denied) };
}
