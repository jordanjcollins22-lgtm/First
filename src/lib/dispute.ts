/**
 * A job that has gone wrong, and what stops happening while it has.
 *
 * The board reads a job's position off what is true about it — booked,
 * quoted, sold, being built. None of that has an answer for a client who is
 * threatening to sue, or refusing to pay, or unhappy in a way that has left
 * the ordinary conversation. Those jobs kept sitting in Operations looking
 * like work to get on with, which is exactly what nobody should do with them.
 *
 * So a dispute is a place on the board, and it wins over every other reading
 * of the job. It is deliberately not a status the job progresses through: a
 * dispute is a thing that happened to a job that already had a position, and
 * when it is resolved the job goes back to being read normally rather than
 * being put somewhere by hand.
 *
 * The second half matters more than the column. A job in dispute is frozen:
 * nothing automatic goes out to that client. A proposal update text or a
 * booking confirmation landing in the inbox of somebody talking to a lawyer
 * is the kind of thing that gets read out later.
 */

export type DisputeKind = "legal" | "payment" | "quality" | "other";

export const DISPUTE_KINDS: { value: DisputeKind; label: string; blurb: string }[] = [
  { value: "legal", label: "Legal", blurb: "A lawyer is involved, or has been threatened." },
  { value: "payment", label: "Payment", blurb: "They are refusing to pay, or have charged back." },
  { value: "quality", label: "Quality", blurb: "They are unhappy with the work itself." },
  { value: "other", label: "Other", blurb: "Something else that has to be sorted before work goes on." },
];

export function kindLabel(kind: string | null | undefined): string {
  return DISPUTE_KINDS.find((k) => k.value === kind)?.label ?? "Other";
}

export function isDisputeKind(value: string): value is DisputeKind {
  return DISPUTE_KINDS.some((k) => k.value === value);
}

/** What a job carries about a dispute. All null on the overwhelming majority. */
export interface DisputeState {
  openedAt: string | null;
  resolvedAt: string | null;
  kind: string | null;
  reason: string | null;
}

export const NO_DISPUTE: DisputeState = {
  openedAt: null,
  resolvedAt: null,
  kind: null,
  reason: null,
};

/**
 * Whether this job is in dispute right now.
 *
 * Resolving records a date rather than clearing the record, so a job that has
 * been through a dispute and come out still says so afterwards. That history
 * is the point: the next person to quote this client should be able to find
 * out that the last job ended with a solicitor's letter.
 */
export function inDispute(state: DisputeState): boolean {
  if (!state.openedAt) return false;
  if (!state.resolvedAt) return true;
  // Opened again after being resolved. Comparing rather than assuming order,
  // because a second dispute writes a new opened date over an old resolved one.
  return state.resolvedAt < state.openedAt;
}

/** Whether this job has ever been in one, resolved or not. */
export function hasDisputeHistory(state: DisputeState): boolean {
  return Boolean(state.openedAt);
}

/**
 * Whether anything automatic may be sent to this client.
 *
 * The one rule that makes the column worth having. A proposal update text, a
 * booking confirmation, a payment receipt — none of them go to somebody who
 * is suing us, unless a person decides to send it. Everything the office
 * types by hand still goes; this stops the machine talking, not the business.
 */
export function mayContactAutomatically(state: DisputeState): boolean {
  return !inDispute(state);
}

/** The line on the card, so the board says what is wrong without opening it. */
export function disputeLine(state: DisputeState): string | null {
  if (!inDispute(state)) return null;
  const kind = kindLabel(state.kind);
  const reason = (state.reason ?? "").trim();
  return reason ? `${kind} — ${reason}` : kind;
}

/** What a resolved-and-closed job says afterwards, for the job page. */
export function historyLine(state: DisputeState): string | null {
  if (!hasDisputeHistory(state) || inDispute(state)) return null;
  return `Was in dispute (${kindLabel(state.kind).toLowerCase()}), resolved.`;
}
