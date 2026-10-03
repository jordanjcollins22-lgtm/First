/**
 * When somebody is already spoken for — across every calendar at once.
 *
 * The calendars in this app are rosters, not separate diaries: evaluations
 * live on the job, work visits live on the job's sessions, time off lives on
 * the person. Nothing ever joined them up, so the booking page happily offered
 * a client a ten o'clock evaluation with somebody who had been on a patio
 * install since eight. The person is the resource, not the calendar, and this
 * is the one place that says so.
 *
 * Everything is reduced to the same shape — a person, a window, and a reason
 * somebody can read — so a new kind of commitment added later becomes another
 * source feeding this, rather than another thing the booking page forgets to
 * check.
 */

import { evaluationWindow, windowsOverlap, type Window } from "@/lib/scheduling";

export type BusySource = "evaluation" | "work_visit" | "time_off";

export const SOURCE_LABELS: Record<BusySource, string> = {
  evaluation: "an evaluation",
  work_visit: "a job",
  time_off: "time off",
};

export interface BusyBlock {
  profileId: string;
  start: Date;
  end: Date;
  source: BusySource;
  /** Where it came from, so a refusal can say which job rather than "busy". */
  label: string;
  /** The job it belongs to, when it has one — lets a check ignore a job's own
   * booking while it is being rescheduled. */
  jobId: string | null;
}

export interface EvaluationBooking {
  jobId: string;
  profileId: string | null;
  startIso: string | null;
  endIso: string | null;
  label: string;
  cancelled: boolean;
}

export interface WorkVisitBooking {
  jobId: string;
  /** Everybody on that job — a visit blocks the whole crew, not just the lead. */
  profileIds: string[];
  /** Date keys, inclusive. Visits are booked by the day, not the hour. */
  startsOn: string;
  endsOn: string;
  label: string;
  cancelled: boolean;
}

export interface TimeOffBooking {
  profileId: string;
  date: string;
  /** Null on both means the whole day. */
  startTime: string | null;
  endTime: string | null;
}

/** Midnight to midnight on a local date key. Work visits are booked by the
 * day: if somebody is on a job on Tuesday they are on it on Tuesday, and
 * carving out a free hour at 2pm is a promise this business cannot keep. */
function wholeDays(startKey: string, endKey: string): Window | null {
  const start = new Date(`${startKey}T00:00:00`);
  const end = new Date(`${endKey}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  if (end < start) return null;
  // End of the last day, not the start of it.
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function timeOnDate(dateKey: string, time: string): Date {
  return new Date(`${dateKey}T${time.slice(0, 5)}:00`);
}

/**
 * Everything that makes somebody unavailable, in one list.
 *
 * Cancelled work is skipped rather than dropped upstream, because the caller
 * that forgets to filter is the caller that blocks a whole crew's week over a
 * visit nobody is going on.
 */
export function busyBlocks({
  evaluations = [],
  visits = [],
  timeOff = [],
}: {
  evaluations?: EvaluationBooking[];
  visits?: WorkVisitBooking[];
  timeOff?: TimeOffBooking[];
}): BusyBlock[] {
  const blocks: BusyBlock[] = [];

  for (const e of evaluations) {
    if (e.cancelled || !e.profileId) continue;
    const window = evaluationWindow(e.startIso, e.endIso);
    if (!window) continue;
    blocks.push({
      profileId: e.profileId,
      start: window.start,
      end: window.end,
      source: "evaluation",
      label: e.label,
      jobId: e.jobId,
    });
  }

  for (const v of visits) {
    if (v.cancelled) continue;
    const window = wholeDays(v.startsOn, v.endsOn);
    if (!window) continue;
    for (const profileId of v.profileIds) {
      blocks.push({
        profileId,
        start: window.start,
        end: window.end,
        source: "work_visit",
        label: v.label,
        jobId: v.jobId,
      });
    }
  }

  for (const t of timeOff) {
    const window =
      t.startTime && t.endTime
        ? { start: timeOnDate(t.date, t.startTime), end: timeOnDate(t.date, t.endTime) }
        : wholeDays(t.date, t.date);
    if (!window || Number.isNaN(window.start.getTime()) || Number.isNaN(window.end.getTime())) continue;
    blocks.push({
      profileId: t.profileId,
      start: window.start,
      end: window.end,
      source: "time_off",
      label: "time off",
      jobId: null,
    });
  }

  return blocks;
}

/**
 * The first thing standing in the way, or null when the window is free.
 *
 * `ignoreJobId` is what makes rescheduling work: a job's own appointment must
 * not block the job from being moved an hour later, which is the single most
 * common thing anybody does on a calendar.
 */
export function conflictFor(
  blocks: BusyBlock[],
  profileId: string,
  window: Window,
  ignoreJobId?: string | null
): BusyBlock | null {
  for (const block of blocks) {
    if (block.profileId !== profileId) continue;
    if (ignoreJobId && block.jobId === ignoreJobId) continue;
    if (windowsOverlap(block, window)) return block;
  }
  return null;
}

/** Everyone free for a window — what a booking page needs to know. */
export function freeOf(blocks: BusyBlock[], profileIds: string[], window: Window): string[] {
  return profileIds.filter((id) => conflictFor(blocks, id, window) === null);
}

function dayLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/**
 * Why somebody cannot be booked, in words a person would use.
 *
 * "Not available" teaches nobody anything. Naming the job and the day is what
 * lets whoever hit the wall decide whether to move this or move that.
 */
export function describeConflict(block: BusyBlock, personName?: string | null): string {
  const who = personName ? `${personName} is` : "They're";
  if (block.source === "time_off") {
    return `${who} off on ${dayLabel(block.start)}.`;
  }
  if (block.source === "work_visit") {
    return `${who} on ${block.label} that day.`;
  }
  return `${who} already booked for ${block.label} at ${block.start.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })} on ${dayLabel(block.start)}.`;
}
