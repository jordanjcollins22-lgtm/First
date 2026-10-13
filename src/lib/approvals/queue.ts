/**
 * One list of everything waiting on the owner.
 *
 * Held emails, prices that need a yes, marketing plays, social posts nobody
 * has sent, property-manager drafts, and exceptions that have come up to the
 * owner each lived on their own screen, so the owner had to remember to look
 * at six places. Here they are one shape, one row each, in one order: the
 * thing that goes stale soonest first, then the oldest.
 *
 * Pure: no reads, no writes.
 */

export const QUEUE_TYPES = ["email", "price", "play", "social", "pm_draft", "exception", "back_office"] as const;
export type QueueType = (typeof QUEUE_TYPES)[number];

export function isQueueType(value: string): value is QueueType {
  return (QUEUE_TYPES as readonly string[]).includes(value);
}

export const QUEUE_TYPE_LABEL: Record<QueueType, string> = {
  email: "Email",
  price: "Price",
  play: "Marketing play",
  social: "Social post",
  pm_draft: "Property-manager email",
  exception: "Exception",
  back_office: "Back office",
};

export interface QueueItem {
  type: QueueType;
  id: string;
  /** What it is, in a few words: "Booking confirmation to Deanna Fields". */
  title: string;
  /** One line under it. */
  detail: string | null;
  /** The kind behind it, for the decline report: an email kind, a play kind. */
  kind: string | null;
  /** When it started waiting. */
  since: string;
  /** When it stops being worth doing, if it does. */
  dueAt: string | null;
  /** Where to open it in full. */
  href: string | null;
  canApprove: boolean;
  /** The approve button's words, since "approve" means a different thing for each. */
  approveLabel: string;
  canDecline: boolean;
  /** Longer words to read before approving: an email's body. */
  body?: string | null;
}

/** Soonest-stale first, then oldest waiting, then by type and id so the order never shuffles. */
export function sortQueue(items: readonly QueueItem[]): QueueItem[] {
  const due = (i: QueueItem) => (i.dueAt ? new Date(i.dueAt).getTime() : Number.POSITIVE_INFINITY);
  return [...items].sort(
    (a, b) =>
      due(a) - due(b) ||
      new Date(a.since).getTime() - new Date(b.since).getTime() ||
      QUEUE_TYPES.indexOf(a.type) - QUEUE_TYPES.indexOf(b.type) ||
      a.id.localeCompare(b.id)
  );
}

export function countByType(items: readonly QueueItem[]): Record<QueueType, number> {
  const counts = Object.fromEntries(QUEUE_TYPES.map((t) => [t, 0])) as Record<QueueType, number>;
  for (const item of items) counts[item.type] += 1;
  return counts;
}

/** "3 things are waiting for you", or "Nothing is waiting for you". */
export function queueLine(count: number): string {
  if (count === 0) return "Nothing is waiting for you";
  if (count === 1) return "1 thing is waiting for you";
  return `${count} things are waiting for you`;
}

/** An exception reaches the owner when it stops work or nobody has picked it up in a day. */
export const EXCEPTION_ESCALATE_AFTER_HOURS = 24;

export function exceptionNeedsOwner(
  row: { state: string; blocksWork: boolean; reportedAt: string },
  now: Date
): boolean {
  if (row.state !== "reported" && row.state !== "acknowledged") return false;
  if (row.blocksWork) return true;
  if (row.state !== "reported") return false;
  return now.getTime() - new Date(row.reportedAt).getTime() >= EXCEPTION_ESCALATE_AFTER_HOURS * 60 * 60 * 1000;
}
