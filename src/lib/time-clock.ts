/**
 * Who was on what, for how long, and what it cost.
 *
 * A scheduled visit says what somebody was meant to do. This says what they
 * actually did — which is the number payroll runs on, and the only honest
 * input to what a job really cost.
 *
 * Every figure here is derived from the two timestamps on an entry. Nothing
 * stores a duration or a total, because a stored total is a number that goes
 * on being right after the times it came from have been corrected.
 */

export interface TimeEntry {
  id: string;
  profileId: string;
  personName: string;
  jobId: string | null;
  jobName: string | null;
  clockedInAt: string;
  /** Null while somebody is still on it. */
  clockedOutAt: string | null;
  note: string | null;
  /** Set when a person has corrected the times by hand. */
  editedByName: string | null;
}

export type PayType = "hourly" | "commission" | "both";

export interface Person {
  id: string;
  name: string;
  payType: PayType;
  payRatePerHour: number | null;
}

/** Still on it. */
export function isOpen(entry: TimeEntry): boolean {
  return entry.clockedOutAt == null;
}

/**
 * How long an entry ran, in hours.
 *
 * An open entry is measured to now, because "three hours so far" is the
 * answer somebody looking at a screen at eleven in the morning wants. A
 * clock-out before the clock-in is nonsense rather than negative time, so it
 * counts as nothing until somebody fixes it.
 */
export function hoursOn(entry: TimeEntry, now: Date = new Date()): number {
  const start = new Date(entry.clockedInAt).getTime();
  const end = entry.clockedOutAt ? new Date(entry.clockedOutAt).getTime() : now.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, (end - start) / 3_600_000);
}

/** "3h 20m", the way somebody says it out loud. */
export function describeHours(hours: number): string {
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  if (whole === 0) return `${minutes}m`;
  return minutes === 0 ? `${whole}h` : `${whole}h ${minutes}m`;
}

/** Everyone on the clock right now. */
export function onTheClock(entries: TimeEntry[]): TimeEntry[] {
  return entries.filter(isOpen).sort((a, b) => a.clockedInAt.localeCompare(b.clockedInAt));
}

export interface PersonDay {
  profileId: string;
  personName: string;
  hours: number;
  entries: TimeEntry[];
  /** Null when this person is not paid by the hour. */
  pay: number | null;
  payType: PayType;
  ratePerHour: number | null;
  /** True while any of their entries is still running. */
  stillOn: boolean;
}

/**
 * A day's work, per person, with what it cost.
 *
 * Commission-only people get no figure rather than a zero: they were paid for
 * this day, just not for these hours, and a zero in a pay column reads as
 * "worked for nothing" rather than "not how this one is paid".
 */
export function dayByPerson(
  entries: TimeEntry[],
  people: Person[],
  now: Date = new Date()
): PersonDay[] {
  const byPerson = new Map<string, TimeEntry[]>();
  for (const entry of entries) {
    const list = byPerson.get(entry.profileId) ?? [];
    list.push(entry);
    byPerson.set(entry.profileId, list);
  }

  const personById = new Map(people.map((person) => [person.id, person]));

  return [...byPerson.entries()]
    .map(([profileId, theirs]) => {
      const person = personById.get(profileId);
      const hours = theirs.reduce((sum, entry) => sum + hoursOn(entry, now), 0);
      const payType = person?.payType ?? "hourly";
      const rate = person?.payRatePerHour ?? null;

      return {
        profileId,
        personName: theirs[0].personName,
        hours,
        entries: [...theirs].sort((a, b) => a.clockedInAt.localeCompare(b.clockedInAt)),
        pay: payFor(hours, rate, payType),
        payType,
        ratePerHour: rate,
        stillOn: theirs.some(isOpen),
      };
    })
    .sort((a, b) => b.hours - a.hours);
}

/**
 * What those hours cost.
 *
 * Null rather than zero when the hours do not decide the pay — either there
 * is no rate on file or the person is on commission only. A made-up zero in a
 * payroll column is worse than a blank, because a blank asks a question and a
 * zero answers one wrongly.
 */
export function payFor(hours: number, ratePerHour: number | null, payType: PayType): number | null {
  if (payType === "commission") return null;
  if (ratePerHour == null) return null;
  return hours * ratePerHour;
}

/** What the whole day cost in wages, across everyone who is paid for hours. */
export function dayWageTotal(days: PersonDay[]): number {
  return days.reduce((sum, day) => sum + (day.pay ?? 0), 0);
}

/** Hours on one job, across everybody. */
export function hoursByJob(entries: TimeEntry[], now: Date = new Date()) {
  const byJob = new Map<string, { jobId: string; jobName: string; hours: number; people: Set<string> }>();

  for (const entry of entries) {
    if (!entry.jobId) continue;
    const found = byJob.get(entry.jobId) ?? {
      jobId: entry.jobId,
      jobName: entry.jobName ?? "Job",
      hours: 0,
      people: new Set<string>(),
    };
    found.hours += hoursOn(entry, now);
    found.people.add(entry.profileId);
    byJob.set(entry.jobId, found);
  }

  return [...byJob.values()]
    .map((job) => ({ ...job, peopleCount: job.people.size }))
    .sort((a, b) => b.hours - a.hours);
}

/**
 * Entries that cannot both be true.
 *
 * One person clocked into two places at once is somebody who forgot to clock
 * out, and it inflates both the hours and the pay. Worth pointing at rather
 * than silently adding up.
 */
export function overlapping(entries: TimeEntry[], now: Date = new Date()): TimeEntry[] {
  const flagged = new Set<string>();
  const byPerson = new Map<string, TimeEntry[]>();

  for (const entry of entries) {
    const list = byPerson.get(entry.profileId) ?? [];
    list.push(entry);
    byPerson.set(entry.profileId, list);
  }

  for (const theirs of byPerson.values()) {
    const sorted = [...theirs].sort((a, b) => a.clockedInAt.localeCompare(b.clockedInAt));
    for (let i = 1; i < sorted.length; i++) {
      const previousEnd = sorted[i - 1].clockedOutAt
        ? new Date(sorted[i - 1].clockedOutAt!).getTime()
        : now.getTime();
      if (new Date(sorted[i].clockedInAt).getTime() < previousEnd) {
        flagged.add(sorted[i - 1].id);
        flagged.add(sorted[i].id);
      }
    }
  }

  return entries.filter((entry) => flagged.has(entry.id));
}

/**
 * Whether a correction makes sense.
 *
 * Checked before it is written rather than after: an entry that ends before
 * it starts produces a negative day, and a day in the future is somebody
 * typing into the wrong box.
 */
export function checkEdit(
  clockedInAt: string,
  clockedOutAt: string | null,
  now: Date = new Date()
): { ok: true } | { ok: false; reason: string } {
  const start = new Date(clockedInAt).getTime();
  if (!Number.isFinite(start)) return { ok: false, reason: "That start time isn't a time." };

  // A minute of slack, so a clock a few seconds fast is not an error.
  if (start > now.getTime() + 60_000) {
    return { ok: false, reason: "That start time is in the future." };
  }

  if (clockedOutAt == null) return { ok: true };

  const end = new Date(clockedOutAt).getTime();
  if (!Number.isFinite(end)) return { ok: false, reason: "That finish time isn't a time." };
  if (end < start) return { ok: false, reason: "That finishes before it starts." };
  if (end > now.getTime() + 60_000) return { ok: false, reason: "That finish time is in the future." };

  return { ok: true };
}
