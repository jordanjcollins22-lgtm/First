/**
 * When a work day closes itself, and when it needs a person.
 *
 * Every past work session in the database was still "scheduled" because the
 * only way to close one was for somebody to remember to. The crew already
 * say when they are finished, so the session closes on that. A session still
 * open at nine at night is the exception: it goes to the job's project lead,
 * who was there, rather than to the owner, who was not.
 *
 * The backlog is not this file's business. Sessions that ended before the
 * automation was switched on are left exactly as they are, for a person to
 * review in one go.
 */

export const OPEN_SESSION_STATUSES = ["scheduled", "in_progress", "paused"] as const;

export interface SessionLike {
  id: string;
  jobId: string;
  /** YYYY-MM-DD */
  startsOn: string;
  endsOn: string;
  status: string;
}

export interface JobDayEvent {
  profileId: string;
  kind: "travelling" | "arrived_job" | "finished_job" | string;
  at: string;
}

export function isOpenSession(status: string): boolean {
  return (OPEN_SESSION_STATUSES as readonly string[]).includes(status);
}

export type FinishVerdict =
  /** The work on this session is done: close it. */
  | "close"
  /** Work happened today but the visit runs on to another day. */
  | "in_progress"
  /** Somebody is still on site. Nothing to do yet. */
  | "wait"
  /** This session is not one today's events are about. */
  | "none";

/**
 * What one day's events at a job mean for one session of it.
 *
 * Done means the lead tapped "Finished here", or, with no lead tap, everybody
 * who arrived has finished. One person leaving early is not the job being
 * done; the lead leaving is, because the lead answers for the site.
 */
export function finishVerdict(session: SessionLike, day: string, events: readonly JobDayEvent[], leadId: string | null): FinishVerdict {
  if (!isOpenSession(session.status)) return "none";
  if (day < session.startsOn || day > session.endsOn) return "none";

  const arrived = new Set(events.filter((e) => e.kind === "arrived_job").map((e) => e.profileId));
  const finished = new Set(events.filter((e) => e.kind === "finished_job").map((e) => e.profileId));
  if (arrived.size === 0 && finished.size === 0) return "none";

  const leadDone = leadId != null && finished.has(leadId);
  const everyoneDone = finished.size > 0 && [...arrived].every((p) => finished.has(p));
  if (!leadDone && !everyoneDone) return "wait";

  // A three-day patio is not finished on Monday afternoon.
  return day >= session.endsOn ? "close" : "in_progress";
}

/** Minutes since midnight that a still-open session becomes an exception. 9pm. */
export const DEFAULT_UNCLOSED_CUTOFF_MINUTES = 21 * 60;

/**
 * Whether an open session has gone past the point of closing itself.
 *
 * Only sessions ending on or after the day the automation went live count.
 * Anything older is the backlog, and the backlog is reviewed by a person in
 * one go, never turned into a pile of fresh alerts.
 */
export function isUnclosedPastCutoff(
  session: SessionLike,
  today: string,
  minutesNow: number,
  options: { cutoffMinutes?: number; liveFromDay: string | null }
): boolean {
  if (!isOpenSession(session.status)) return false;
  if (!options.liveFromDay || session.endsOn < options.liveFromDay) return false;
  const cutoff = options.cutoffMinutes ?? DEFAULT_UNCLOSED_CUTOFF_MINUTES;
  if (session.endsOn < today) return true;
  return session.endsOn === today && minutesNow >= cutoff;
}

/** Backlog: open sessions that ended before the automation went live (or before today, with no go-live). */
export function isBacklog(session: SessionLike, today: string, liveFromDay: string | null): boolean {
  if (!isOpenSession(session.status)) return false;
  if (session.endsOn >= today) return false;
  return liveFromDay == null || session.endsOn < liveFromDay;
}

/** The exception's words. Short, because it is read on a phone at night. */
export function unclosedSummary(input: { address: string | null; endsOn: string; anyArrival: boolean }): string {
  const where = input.address || "a job";
  return input.anyArrival
    ? `Work day at ${where} (${input.endsOn}) has no "Finished here" tap. Close it or say what happened.`
    : `Nobody tapped in at ${where} on ${input.endsOn}. Was the work done?`;
}
