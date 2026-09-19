import type { Stop, Verdict } from "@/lib/crew-day";

/**
 * The next job a crew member could start before it is due.
 *
 * A crew that finishes at two o'clock has three hours of daylight and nothing
 * to do with them. The office finds out tomorrow. Meanwhile the customer
 * booked for Thursday would have taken Tuesday gladly, and nobody asked them.
 *
 * So when the day's work is done, the next job on this person's list surfaces
 * with one button: ask to start it now. It is a request and not a start —
 * the account manager owns the customer's expectations, and a crew turning up
 * two days early unannounced is a complaint, not a favour.
 */

/** A visit booked for a later day that this person is on. */
export interface UpcomingVisit {
  jobId: string;
  sessionId: string;
  address: string;
  customerName: string;
  /** YYYY-MM-DD, the day the visit is booked to start. */
  startsOn: string;
  purpose: string | null;
}

export type EarlyStartStatus = "pending" | "approved" | "declined";

export interface EarlyStartRequest {
  id: string;
  sessionId: string;
  status: EarlyStartStatus;
  /** The day they asked to do it on. */
  requestedFor: string;
  declineReason: string | null;
}

/**
 * Which upcoming job to offer, if any.
 *
 * Only once every stop booked for today is finished. Offered earlier it is an
 * invitation to skip the job they are standing on, and the whole point is
 * that this is what to do with the time *after* the work is done.
 *
 * The earliest upcoming visit wins. Letting somebody pull work forward out of
 * order turns the schedule into a set of suggestions.
 */
export function nextUp(options: {
  today: string;
  stops: Stop[];
  finishedJobIds: string[];
  upcoming: UpcomingVisit[];
}): UpcomingVisit | null {
  if (remainingToday(options.stops, options.finishedJobIds) > 0) return null;

  const later = options.upcoming
    .filter((v) => v.startsOn > options.today)
    .sort((a, b) =>
      a.startsOn === b.startsOn ? (a.sessionId < b.sessionId ? -1 : 1) : a.startsOn < b.startsOn ? -1 : 1
    );

  return later[0] ?? null;
}

/** How many of today's stops are still open. */
export function remainingToday(stops: Stop[], finishedJobIds: string[]): number {
  const finished = new Set(finishedJobIds);
  return stops.filter((s) => !finished.has(s.jobId)).length;
}

/**
 * Whether this person can ask to start the next job early, right now.
 *
 * Every refusal names the thing standing in the way. A greyed-out button with
 * no reason is read as a broken button, and the crew stop pressing it.
 */
export function canRequestEarlyStart(options: {
  today: string;
  visit: UpcomingVisit | null;
  existing: EarlyStartRequest | null;
  stops: Stop[];
  finishedJobIds: string[];
}): Verdict {
  const remaining = remainingToday(options.stops, options.finishedJobIds);
  if (remaining > 0) {
    return {
      ok: false,
      reason:
        remaining === 1
          ? "Finish today's last stop first."
          : `Finish today's ${remaining} remaining stops first.`,
    };
  }
  if (!options.visit) return { ok: false, reason: "Nothing else is booked for you yet." };
  if (options.visit.startsOn <= options.today) {
    return { ok: false, reason: "That one is already today's work." };
  }

  const existing = options.existing;
  if (existing && existing.sessionId === options.visit.sessionId) {
    if (existing.status === "pending") {
      return { ok: false, reason: "Asked — waiting on the account manager." };
    }
    if (existing.status === "approved") {
      return { ok: false, reason: "Approved. It's on your list now." };
    }
    // Declined is not final. A no at nine in the morning and a no at three in
    // the afternoon are different questions, and the crew can see the reason.
  }

  return { ok: true };
}

/** What the crew's card says about a request that already exists. */
export function describeRequest(request: EarlyStartRequest | null): string | null {
  if (!request) return null;
  if (request.status === "pending") return "Waiting on the account manager.";
  if (request.status === "approved") return "Approved — go ahead.";
  return request.declineReason
    ? `Not this time: ${request.declineReason}`
    : "Not this time.";
}

/**
 * Whether an account manager still has to answer this.
 *
 * A request for a day that has already passed is not a decision anybody needs
 * to make any more; leaving it in the queue trains people to ignore the queue.
 */
export function isStillOpen(request: EarlyStartRequest, today: string): boolean {
  return request.status === "pending" && request.requestedFor >= today;
}

/** The queue an account manager works through, soonest first. */
export function openRequests<T extends EarlyStartRequest>(requests: T[], today: string): T[] {
  return requests
    .filter((r) => isStillOpen(r, today))
    .sort((a, b) =>
      a.requestedFor === b.requestedFor
        ? a.id < b.id
          ? -1
          : 1
        : a.requestedFor < b.requestedFor
          ? -1
          : 1
    );
}
