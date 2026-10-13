/**
 * How many hours each person really put into a job.
 *
 * The crew already tap "Leaving the shop", "I've arrived" and "Finished here"
 * for the crew day, so the hours a job took are sitting in that log. Nobody
 * has to type them in at the end, which is why final hours were never filled
 * in before: typing a number from memory a week later is the step people skip.
 *
 * The rules, in the order they matter:
 *
 * 1. **On site** is arrived → finished at that job.
 * 2. **Travel** to a stop starts the moment the person became free to head
 *    there: leaving the shop for the first stop, finishing the previous stop
 *    for every later one. Paid time between stops belongs to the next job,
 *    which is how drive time is costed everywhere else in the trade. A day
 *    with no shop (meet on site) starts travel at the "On my way" tap.
 * 3. Time at the shop in the morning and the drive back at night belong to
 *    no single job. They are reported as unallocated, not spread around.
 * 4. A stop with an arrival and no finish is **unclosed**. Live, it counts to
 *    now. After the day, it ends at "Back at the shop" if there is one, and
 *    otherwise it counts nothing and is flagged, because inventing an end
 *    time is how a costing becomes fiction.
 * 5. The time clock (time_entries) fills in where the crew day has nothing.
 *    For one person, one job, one day, events win and the clock is ignored;
 *    counting both would bill the same hours twice.
 *
 * Pure: the database rows come in, numbers go out, and the tests pin it.
 */

import type { CrewEventKind } from "@/lib/crew-day";
import { dateKeyIn } from "@/lib/time-zone";

export interface CrewEventRow {
  profileId: string;
  /** The working day the event belongs to, YYYY-MM-DD. */
  day: string;
  kind: CrewEventKind;
  jobId: string | null;
  at: string;
}

export interface ClockEntryRow {
  profileId: string;
  jobId: string | null;
  clockedInAt: string;
  clockedOutAt: string | null;
}

export interface JobStint {
  profileId: string;
  jobId: string;
  day: string;
  travelHours: number;
  onSiteHours: number;
  /** How the on-site time ended. */
  endedBy: "finished" | "returned_shop" | "now" | "open";
}

export interface DayStints {
  stints: JobStint[];
  /** Shop time and the drive home: paid, but not any one job's. */
  unallocatedHours: number;
}

const HOUR = 3_600_000;

function ms(at: string): number {
  return new Date(at).getTime();
}

function hoursBetween(from: number | null, to: number | null): number {
  if (from == null || to == null || !Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, (to - from) / HOUR);
}

/**
 * One person's day, cut into stints per job.
 *
 * `now` is passed only for a live reading (today's screen). Without it, an
 * unclosed stop is never measured to the present, so a costing run tonight
 * and a costing run next month give the same answer.
 */
export function stintsForDay(events: readonly CrewEventRow[], now: Date | null = null): DayStints {
  const sorted = [...events].sort((a, b) => ms(a.at) - ms(b.at));
  const returned = sorted.find((e) => e.kind === "returned_shop") ?? null;
  const arrivedShop = sorted.find((e) => e.kind === "arrived_shop") ?? null;
  const leftShop = sorted.find((e) => e.kind === "left_shop") ?? null;

  const stints: JobStint[] = [];
  let freeSince: number | null = leftShop ? ms(leftShop.at) : null;
  let lastFinish: number | null = null;

  // Each arrival opens a stint; the matching finish (the first one after it,
  // for the same job) closes it.
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    if (e.kind !== "arrived_job" || !e.jobId) continue;
    const arrivedAt = ms(e.at);

    // Travel: from when they became free, or the "On my way" tap on a day
    // with no shop. Never before the previous finish, never after arrival.
    const onMyWay = [...sorted.slice(0, i)].reverse().find((x) => x.kind === "travelling" && x.jobId === e.jobId) ?? null;
    let travelFrom = freeSince ?? (onMyWay ? ms(onMyWay.at) : null);
    if (travelFrom != null && travelFrom > arrivedAt) travelFrom = null;

    const finish = sorted.slice(i + 1).find((x) => x.kind === "finished_job" && x.jobId === e.jobId) ?? null;
    let end: number | null;
    let endedBy: JobStint["endedBy"];
    if (finish) {
      end = ms(finish.at);
      endedBy = "finished";
    } else if (now) {
      end = now.getTime();
      endedBy = "now";
    } else if (returned && ms(returned.at) > arrivedAt) {
      end = ms(returned.at);
      endedBy = "returned_shop";
    } else {
      end = null;
      endedBy = "open";
    }

    stints.push({
      profileId: e.profileId,
      jobId: e.jobId,
      day: e.day,
      travelHours: hoursBetween(travelFrom, arrivedAt),
      onSiteHours: hoursBetween(arrivedAt, end),
      endedBy,
    });

    if (end != null) {
      freeSince = end;
      lastFinish = end;
    } else {
      freeSince = null;
    }
  }

  // The morning at the shop, and the drive back after the last stop.
  const shopMorning = arrivedShop && leftShop ? hoursBetween(ms(arrivedShop.at), ms(leftShop.at)) : 0;
  const driveHome = returned && lastFinish != null ? hoursBetween(lastFinish, ms(returned.at)) : 0;

  return { stints, unallocatedHours: shopMorning + driveHome };
}

export interface PersonHours {
  profileId: string;
  hours: number;
  travelHours: number;
  onSiteHours: number;
  days: string[];
  source: "events" | "clock" | "both";
}

export interface JobHours {
  jobId: string;
  totalHours: number;
  travelHours: number;
  onSiteHours: number;
  people: PersonHours[];
  /** Stops somebody arrived at and never finished. Counted as nothing. */
  unclosedStops: number;
  /** Clock entries still running, when not reading live. */
  openClockEntries: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Every person's hours on one job, from the crew day and the clock.
 *
 * `events` may hold other jobs' events too: a person's whole day is needed to
 * know when they left the previous stop. Only stints on `jobId` are counted.
 */
export function hoursForJob(
  jobId: string,
  events: readonly CrewEventRow[],
  clock: readonly ClockEntryRow[],
  options: { now?: Date | null; timeZone?: string } = {}
): JobHours {
  const now = options.now ?? null;
  const byPersonDay = new Map<string, CrewEventRow[]>();
  for (const e of events) {
    const key = `${e.profileId}|${e.day}`;
    const list = byPersonDay.get(key) ?? [];
    list.push(e);
    byPersonDay.set(key, list);
  }

  type Tally = PersonHours & { fromEvents: boolean; fromClock: boolean };
  const people = new Map<string, Tally>();
  const person = (profileId: string) => {
    let p = people.get(profileId);
    if (!p) {
      p = { profileId, hours: 0, travelHours: 0, onSiteHours: 0, days: [], source: "events", fromEvents: false, fromClock: false };
      people.set(profileId, p);
    }
    return p;
  };
  const covered = new Set<string>();
  let unclosedStops = 0;

  for (const [, dayEvents] of byPersonDay) {
    // A live reading only measures today's open stop to now: last Tuesday's
    // unclosed stop is not still going.
    const day = dayEvents[0].day;
    const live = now && dateKeyIn(now, options.timeZone) === day ? now : null;
    const { stints } = stintsForDay(dayEvents, live);
    for (const s of stints) {
      if (s.jobId !== jobId) continue;
      if (s.endedBy === "open") unclosedStops++;
      const p = person(s.profileId);
      p.fromEvents = true;
      p.travelHours += s.travelHours;
      p.onSiteHours += s.onSiteHours;
      if (!p.days.includes(s.day)) p.days.push(s.day);
      covered.add(`${s.profileId}|${s.day}`);
    }
  }

  let openClockEntries = 0;
  for (const entry of clock) {
    if (entry.jobId !== jobId) continue;
    const day = dateKeyIn(new Date(entry.clockedInAt), options.timeZone);
    if (covered.has(`${entry.profileId}|${day}`)) continue;
    let end: number | null = entry.clockedOutAt ? ms(entry.clockedOutAt) : null;
    if (end == null) {
      if (now) end = now.getTime();
      else {
        openClockEntries++;
        continue;
      }
    }
    const h = hoursBetween(ms(entry.clockedInAt), end);
    const p = person(entry.profileId);
    p.fromClock = true;
    p.onSiteHours += h;
    if (!p.days.includes(day)) p.days.push(day);
  }

  const list: PersonHours[] = [...people.values()]
    .map(({ fromEvents, fromClock, ...p }) => ({
      ...p,
      source: (fromEvents && fromClock ? "both" : fromClock ? "clock" : "events") as PersonHours["source"],
      travelHours: round2(p.travelHours),
      onSiteHours: round2(p.onSiteHours),
      hours: round2(p.travelHours + p.onSiteHours),
      days: [...p.days].sort(),
    }))
    .sort((a, b) => b.hours - a.hours);

  const travel = list.reduce((s, p) => s + p.travelHours, 0);
  const onSite = list.reduce((s, p) => s + p.onSiteHours, 0);
  return {
    jobId,
    totalHours: round2(travel + onSite),
    travelHours: round2(travel),
    onSiteHours: round2(onSite),
    people: list,
    unclosedStops,
    openClockEntries,
  };
}
