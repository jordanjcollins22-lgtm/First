/**
 * Who is "in" an automated message right now: somebody it will still send
 * to. Mirrors the senders' own timing (cron/client-reminders and the
 * evaluation_sequence_due() SQL), so a name on the list is somebody the next
 * run can actually reach. Pure, so it can be tested without a database.
 */

export interface AutomationPerson {
  name: string;
  /** Why they are in it, e.g. "Evaluation Oct 14, 10:00 AM". */
  why: string;
  /** The next message they will get, and when. */
  next: string;
  /** What opens when they're clicked: the job, proposal or person behind it. */
  ref?: { kind: string; id: string };
}

export interface Automation {
  id: string;
  name: string;
  /** Who receives it. */
  to: "Clients" | "Team" | "Owner";
  channel: "Email" | "Text" | "Text or email";
  /** One line: what starts it and what stops it. */
  how: string;
  on: boolean;
  /** Said instead of the count's usual meaning when it is off. */
  offNote?: string;
  people: AutomationPerson[];
}

const HOUR = 3600_000;

/** A wall-clock time in a time zone, as an instant. */
export function zonedTime(ymd: string, hour: number, minute: number, timeZone: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const shown = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return new Date(guess - (shown - guess));
}

/** The calendar day an instant falls on in a time zone, as YYYY-MM-DD. */
export function localDay(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const EVALUATION_STEPS = ["booked", "two_days", "day_before", "morning_of", "after"] as const;
export type EvaluationStep = (typeof EVALUATION_STEPS)[number];
export const STEP_LABEL: Record<EvaluationStep, string> = {
  booked: "booking confirmation",
  two_days: "two days before",
  day_before: "the day before",
  morning_of: "the morning of",
  after: "thank-you after the visit",
};

/**
 * The evaluation email series for one visit: the steps still to go, earliest
 * first. A step is still to go when it isn't logged, isn't switched off, its
 * window hasn't closed, and (except the confirmation) the visit was booked
 * before it was due.
 */
export function evaluationStepsToGo(input: {
  evaluationAt: Date;
  bookedAt: Date;
  now: Date;
  timeZone: string;
  sent: ReadonlySet<EvaluationStep>;
  disabled: ReadonlySet<EvaluationStep>;
}): { step: EvaluationStep; at: Date }[] {
  const { evaluationAt: e, bookedAt: c, now, timeZone: tz } = input;
  const day = localDay(e, tz);
  const windows: Record<EvaluationStep, [Date, Date]> = {
    booked: [c, new Date(Math.min(c.getTime() + 72 * HOUR, e.getTime()))],
    two_days: [zonedTime(addDays(day, -2), 9, 0, tz), new Date(zonedTime(addDays(day, -2), 9, 0, tz).getTime() + 4 * HOUR)],
    day_before: [zonedTime(addDays(day, -1), 17, 0, tz), new Date(zonedTime(addDays(day, -1), 17, 0, tz).getTime() + 4 * HOUR)],
    morning_of: [
      zonedTime(day, 8, 0, tz),
      new Date(Math.min(zonedTime(day, 8, 0, tz).getTime() + 3 * HOUR, e.getTime() - 20 * 60_000)),
    ],
    after: [new Date(e.getTime() + 3 * HOUR), new Date(e.getTime() + 23 * HOUR)],
  };
  return EVALUATION_STEPS.filter((s) => {
    const [fire, until] = windows[s];
    if (input.sent.has(s) || input.disabled.has(s)) return false;
    if (until <= now || until <= fire) return false;
    return s === "booked" || c < fire;
  }).map((s) => ({ step: s, at: windows[s][0] }));
}

/**
 * The offsets of a reminder rule still to go for one thing (a visit, a
 * proposal, a start date): not logged, and not more than a day late, which is
 * as late as the sender will still send one.
 */
export function offsetsToGo(anchor: Date, offsetsHours: readonly number[], now: Date, sent: ReadonlySet<number>): { offset: number; at: Date }[] {
  return offsetsHours
    .filter((o) => !sent.has(o) && anchor.getTime() + (o + 24) * HOUR > now.getTime())
    .map((o) => ({ offset: o, at: new Date(anchor.getTime() + o * HOUR) }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** "Now" when it is already due, otherwise the time. */
export function whenText(at: Date, now: Date, timeZone: string): string {
  if (at <= now) return "going out on the next run";
  return at.toLocaleString("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
