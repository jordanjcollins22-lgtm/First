import type { ProposalZoneSnapshot } from "@/types/domain";

/**
 * Sending an evaluation again once something about it has changed.
 *
 * A proposal is a snapshot: the price and the wording are frozen the moment
 * it is generated, deliberately, so a client reading a link cannot have the
 * number move under them. The cost of that is that changing the services on
 * the site map afterwards does nothing at all — the proposal keeps saying
 * whatever it said, and the only way to fix it is to make a new snapshot.
 *
 * Which the app had no button for. Submitting an evaluation was a one-way
 * door: the button disabled itself the moment the status went to completed,
 * so an evaluation corrected an hour later left a proposal quoting the wrong
 * work with nothing anybody could press.
 */

export type ProposalStatus = "needs_approval" | "sent" | "accepted" | "declined";

export interface ExistingProposal {
  status: ProposalStatus;
  respondedAt: string | null;
}

export interface RegenDecision {
  /** Whether to go ahead now, without asking anything first. */
  allowed: boolean;
  /**
   * What the person has to agree to before this proceeds. Null when nothing
   * is at stake.
   */
  confirm: string | null;
  /** What will happen, worth saying even when nothing needs confirming. */
  note: string | null;
}

/**
 * Whether a new snapshot can just be taken, or somebody has to agree first.
 *
 * The one case that gets in the way is an accepted proposal. Regenerating
 * clears the acceptance — that is not a bug, a client agreed to work that is
 * no longer what we are proposing — but it destroys a record of somebody
 * saying yes, and that should never happen because a button was in the way of
 * something else.
 */
export function regenDecision(existing: ExistingProposal | null): RegenDecision {
  if (!existing) {
    return { allowed: true, confirm: null, note: null };
  }

  if (existing.status === "accepted") {
    return {
      allowed: false,
      confirm:
        "This client has already accepted this proposal. Sending a new one clears that acceptance — they will have to accept the new scope and price. Carry on?",
      note: null,
    };
  }

  if (existing.status === "sent") {
    return {
      allowed: true,
      confirm: null,
      // Not a confirmation: dropping back to needs_approval is the correct
      // and safe outcome, and a client seeing a stale price is the worse one.
      note: "The client's link goes back to unapproved until somebody approves the new version.",
    };
  }

  if (existing.status === "declined") {
    return {
      allowed: true,
      confirm: null,
      note: "This one was declined. The new version replaces it and their decline is cleared.",
    };
  }

  return { allowed: true, confirm: null, note: "The draft awaiting approval will be replaced." };
}

// ---------------------------------------------------------------------------
// What actually changed
// ---------------------------------------------------------------------------

export interface ScopeChangeLine {
  zoneName: string;
  before: string | null;
  after: string | null;
}

export interface ScopeDiff {
  changed: ScopeChangeLine[];
  added: ScopeChangeLine[];
  removed: ScopeChangeLine[];
  /** True when the new snapshot says exactly what the old one said. */
  identical: boolean;
}

type SnapshotLike = Pick<ProposalZoneSnapshot, "zoneName" | "serviceLabel">;

/**
 * What is different between the proposal on file and the one about to replace it.
 *
 * Shown back before and after resubmitting, because "the paperwork is stuck on
 * lawn care" is a thing somebody discovers days later. A resubmit that lists
 * "Front lawn: Lawn Care → Weed Removal" is one they can check on the spot.
 *
 * Matched on zone name, which is what a person renames a zone by and therefore
 * what they think of it as. A renamed zone reads as one removed and one added,
 * which is honest — we cannot tell that apart from an actual swap.
 */
export function diffScope(before: SnapshotLike[], after: SnapshotLike[]): ScopeDiff {
  const beforeBy = new Map(before.map((z) => [z.zoneName, z.serviceLabel]));
  const afterBy = new Map(after.map((z) => [z.zoneName, z.serviceLabel]));

  const changed: ScopeChangeLine[] = [];
  const added: ScopeChangeLine[] = [];
  const removed: ScopeChangeLine[] = [];

  for (const [zoneName, afterLabel] of afterBy) {
    if (!beforeBy.has(zoneName)) {
      added.push({ zoneName, before: null, after: afterLabel });
      continue;
    }
    const beforeLabel = beforeBy.get(zoneName)!;
    if (beforeLabel !== afterLabel) {
      changed.push({ zoneName, before: beforeLabel, after: afterLabel });
    }
  }

  for (const [zoneName, beforeLabel] of beforeBy) {
    if (!afterBy.has(zoneName)) {
      removed.push({ zoneName, before: beforeLabel, after: null });
    }
  }

  return {
    changed,
    added,
    removed,
    identical: changed.length === 0 && added.length === 0 && removed.length === 0,
  };
}

/** One line per change, for a list somebody reads on a phone. */
export function describeDiff(diff: ScopeDiff): string[] {
  return [
    ...diff.changed.map((c) => `${c.zoneName}: ${c.before} → ${c.after}`),
    ...diff.added.map((c) => `${c.zoneName}: added (${c.after})`),
    ...diff.removed.map((c) => `${c.zoneName}: removed (${c.before})`),
  ];
}

/** What the submit button should say. */
export function submitLabel(evaluationStatus: string, busy: boolean): string {
  if (busy) return "Submitting…";
  return evaluationStatus === "completed" ? "Update & resend proposal" : "Submit Evaluation";
}

/**
 * Whether the button does anything.
 *
 * Only "no job to submit against" disables it now. It used to disable itself
 * the moment an evaluation was completed, which is what made a correction
 * impossible.
 */
export function canSubmit(jobId: string | null | undefined, busy: boolean): boolean {
  return Boolean(jobId) && !busy;
}
