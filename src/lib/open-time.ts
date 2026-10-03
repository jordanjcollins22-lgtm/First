import { zonedToUtc, timeOnly } from "@/lib/time-zone";

/**
 * The hours between evaluations, and what to do with them.
 *
 * An evaluator with two visits in a day has six hours in between. Those
 * hours are where the next jobs come from: comments under neighbours'
 * posts, replies to messages, links sent to people who asked. This works
 * out the open hours from the day's appointments, sets a play for each
 * gap, and scores the day by what was actually done in it, so open time
 * that produced nothing is visible rather than merely gone.
 */
export const WORKDAY_START = "08:00";
export const WORKDAY_END = "17:00";
/** A gap shorter than this is travel and a coffee, not a work block. */
export const MIN_GAP_MINUTES = 45;

export interface Appointment {
  startsAt: string;
  endsAt: string | null;
  label: string;
}

export interface OpenBlock {
  startsAt: string;
  endsAt: string;
  minutes: number;
  /** What is before and after it, for the sentence. */
  before: string | null;
  after: string | null;
}

export interface Play {
  comments: number;
  replies: number;
  links: number;
  calls: boolean;
}

export interface OutreachCounts {
  comments: number;
  dms: number;
  posts: number;
  links: number;
  /** Evaluations booked through this person's links. */
  bookings: number;
}

export interface DayScore {
  openMinutes: number;
  actions: number;
  /** Actions per open hour, rounded to one place. Null with no open time. */
  perOpenHour: number | null;
  bookings: number;
  verdict: "no_open_time" | "idle" | "slow" | "working" | "strong";
}

export function workingWindow(day: string, timeZone?: string): { start: Date; end: Date } {
  return { start: zonedToUtc(day, WORKDAY_START, timeZone), end: zonedToUtc(day, WORKDAY_END, timeZone) };
}

/** The gaps in a day, from the working hours minus the appointments, in order. */
export function openBlocks(
  appointments: readonly Appointment[],
  window: { start: Date; end: Date },
  minMinutes: number = MIN_GAP_MINUTES
): OpenBlock[] {
  const busy = appointments
    .map((a) => {
      const start = new Date(a.startsAt);
      const end = a.endsAt ? new Date(a.endsAt) : new Date(start.getTime() + 60 * 60_000);
      return { start, end, label: a.label };
    })
    .filter((a) => a.end > window.start && a.start < window.end)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const out: OpenBlock[] = [];
  let cursor = window.start;
  let before: string | null = null;
  for (const a of busy) {
    if (a.start > cursor) {
      const minutes = Math.round((a.start.getTime() - cursor.getTime()) / 60_000);
      if (minutes >= minMinutes) out.push({ startsAt: cursor.toISOString(), endsAt: a.start.toISOString(), minutes, before, after: a.label });
    }
    if (a.end > cursor) cursor = a.end;
    before = a.label;
  }
  if (window.end > cursor) {
    const minutes = Math.round((window.end.getTime() - cursor.getTime()) / 60_000);
    if (minutes >= minMinutes) out.push({ startsAt: cursor.toISOString(), endsAt: window.end.toISOString(), minutes, before, after: null });
  }
  return out;
}

export function totalOpenMinutes(blocks: readonly OpenBlock[]): number {
  return blocks.reduce((sum, b) => sum + b.minutes, 0);
}

/** What one gap should produce. Roughly ten minutes a comment, with the rest for replies and links. */
export function playFor(minutes: number): Play {
  const hours = minutes / 60;
  return {
    comments: Math.max(1, Math.round(hours * 4)),
    replies: minutes >= 45 ? Math.max(1, Math.round(hours * 2)) : 0,
    links: Math.max(1, Math.round(hours)),
    calls: minutes >= 90,
  };
}

export function describePlay(play: Play): string {
  const parts = [
    `${play.comments} comment${play.comments === 1 ? "" : "s"} under posts asking for a landscaper`,
    play.replies > 0 ? `reply to ${play.replies} message${play.replies === 1 ? "" : "s"} or DM${play.replies === 1 ? "" : "s"}` : null,
    `${play.links} affiliate link${play.links === 1 ? "" : "s"} to someone who asked`,
    play.calls ? "work the call list" : null,
  ].filter(Boolean);
  return parts.join(", ") + ".";
}

export function minutesLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} hr${h === 1 ? "" : "s"}`;
  return `${h} hr${h === 1 ? "" : "s"} ${m} min`;
}

export function blockLabel(block: OpenBlock, timeZone?: string): string {
  return `${timeOnly(block.startsAt, timeZone)} to ${timeOnly(block.endsAt, timeZone)}`;
}

export function totalActions(counts: OutreachCounts): number {
  return counts.comments + counts.dms + counts.posts + counts.links;
}

/** The day's mark: how much was done with the time that was open. */
export function scoreDay(openMinutes: number, counts: OutreachCounts): DayScore {
  const actions = totalActions(counts);
  if (openMinutes < MIN_GAP_MINUTES) {
    return { openMinutes, actions, perOpenHour: null, bookings: counts.bookings, verdict: "no_open_time" };
  }
  const perOpenHour = Math.round((actions / (openMinutes / 60)) * 10) / 10;
  const verdict = actions === 0 ? "idle" : perOpenHour < 2 ? "slow" : perOpenHour < 5 ? "working" : "strong";
  return { openMinutes, actions, perOpenHour, bookings: counts.bookings, verdict };
}

export function verdictLabel(verdict: DayScore["verdict"]): string {
  switch (verdict) {
    case "no_open_time":
      return "Booked solid";
    case "idle":
      return "Nothing done with the open time";
    case "slow":
      return "Under pace";
    case "working":
      return "On pace";
    case "strong":
      return "Strong";
  }
}
