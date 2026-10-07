/**
 * What is actually outstanding in the inbox.
 *
 * "Needs a reply" used to be a sort order over the whole list, worked out
 * from who spoke last. Two problems with that. It showed every conversation,
 * so the label named a section that contained everything. And it had no way
 * to be finished with something: ring a client back rather than typing, and
 * their message sits at the top of the list for good, because as far as the
 * app knows they still spoke last.
 *
 * So it is a filter, and there is a way to say "dealt with" — a read mark
 * per conversation, held for the whole office rather than per person, since
 * a client waiting on an answer is waiting on the business and not on
 * whoever happened to open the app.
 */

export interface ReplyState {
  /** Who wrote the last message: "client" or "team". */
  lastAuthorType: string;
  /** When that message landed. */
  lastMessageAt: string;
  /** How far the office has marked this conversation read. Null means never. */
  readThrough: string | null;
}

/**
 * Whether this conversation is waiting on us.
 *
 * The client spoke last, and nobody has marked the conversation read since.
 * A reply is the usual way to clear it, and marking read is the way to clear
 * it when the answer went out some other way.
 */
export function needsReply(state: ReplyState): boolean {
  if (state.lastAuthorType !== "client") return false;
  if (!state.readThrough) return true;
  return state.readThrough < state.lastMessageAt;
}

/** Only the ones waiting on us. */
export function filterNeedsReply<T extends ReplyState>(items: T[]): T[] {
  return items.filter(needsReply);
}

export function countNeedsReply(items: ReplyState[]): number {
  return items.filter(needsReply).length;
}

/**
 * Whether marking read would change anything.
 *
 * A conversation where we spoke last has nothing to acknowledge, and one
 * already marked read past its last message is already done. Offering the
 * button anyway is how somebody learns to stop trusting it.
 */
export function canMarkRead(state: ReplyState): boolean {
  return needsReply(state);
}

// ---------------------------------------------------------------------------
// What a message is about
// ---------------------------------------------------------------------------

/**
 * The line shown above a client's message saying what they were looking at.
 *
 * Snapshotted at send time rather than resolved later: it describes the
 * screen they were on, and an area renamed next week does not change what
 * they were asking about.
 */
export function referenceLine(label: string | null | undefined): string | null {
  const trimmed = (label ?? "").trim();
  return trimmed ? `Re: ${trimmed}` : null;
}

/** How a message sent from one area of a proposal is labelled. */
export function zoneReference(zoneName: string, serviceLabel?: string | null): string {
  const zone = zoneName.trim();
  const service = (serviceLabel ?? "").trim();
  if (!zone) return service || "Proposal";
  return service ? `${zone} (${service})` : zone;
}

/** How a message sent from the proposal as a whole is labelled. */
export const PROPOSAL_REFERENCE = "Their proposal";
