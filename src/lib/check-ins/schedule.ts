/**
 * Pure scheduling math for check-ins. Schedules are stored as local wall-clock
 * times ("08:30" on Mon-Fri) in each team member's timezone; the cron route
 * runs every few minutes and asks "which occurrences became due since the last
 * run?" via dueOccurrences().
 */

export interface ScheduleTiming {
  days_of_week: number[];
  time_of_day: string;
}

interface LocalDate {
  year: number;
  month: number;
  day: number;
  weekday: number;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: WEEKDAYS.indexOf(get("weekday")),
  };
}

/** Milliseconds the zone is ahead of UTC at `date`. */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

export function localDate(date: Date, timeZone: string): LocalDate {
  const { year, month, day, weekday } = zonedParts(date, timeZone);
  return { year, month, day, weekday };
}

/** The UTC instant at which it is `hh:mm` on the given local date in `timeZone`. */
export function zonedWallTimeToUtc(
  date: Pick<LocalDate, "year" | "month" | "day">,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  const guess = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  const first = guess - zoneOffsetMs(new Date(guess), timeZone);
  // Re-check the offset at the candidate instant so DST transitions land right.
  return new Date(guess - zoneOffsetMs(new Date(first), timeZone));
}

export function parseTimeOfDay(value: string): { hour: number; minute: number } | null {
  const m = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return m ? { hour: Number(m[1]), minute: Number(m[2]) } : null;
}

/**
 * Occurrences of `schedule` in the window (now - lookbackMinutes, now].
 * The lookback lets the cron catch up after a delayed run without ever
 * texting about something from hours ago.
 */
export function dueOccurrences(
  schedule: ScheduleTiming,
  timeZone: string,
  now: Date,
  lookbackMinutes: number
): Date[] {
  const time = parseTimeOfDay(schedule.time_of_day);
  if (!time) return [];

  const windowStart = now.getTime() - lookbackMinutes * 60_000;
  const seen = new Set<string>();
  const result: Date[] = [];

  // Today and yesterday (local) cover any lookback up to 24h, incl. midnight.
  for (const probe of [now, new Date(now.getTime() - 24 * 60 * 60_000)]) {
    const d = localDate(probe, timeZone);
    const key = `${d.year}-${d.month}-${d.day}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!schedule.days_of_week.includes(d.weekday)) continue;

    const at = zonedWallTimeToUtc(d, time.hour, time.minute, timeZone);
    if (at.getTime() > windowStart && at.getTime() <= now.getTime()) result.push(at);
  }

  return result.sort((a, b) => a.getTime() - b.getTime());
}

export function renderCheckInMessage(
  template: string,
  vars: { name: string; job?: string | null }
): string {
  const firstName = vars.name.trim().split(/\s+/)[0] ?? vars.name;
  return template
    .replace(/\{name\}/gi, firstName)
    .replace(/\{job\}/gi, vars.job ?? "today's job")
    .trim();
}
