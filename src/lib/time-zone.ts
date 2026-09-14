/**
 * The business's clock.
 *
 * Every timestamp in the database is a real instant. What a person means by
 * "Monday at 8" is a wall-clock time in the business's own zone, and the
 * server that turns one into the other runs on UTC. These are the few
 * functions that cross that line, so nothing else has to think about it.
 *
 * The evaluation times used to be written the other way round: the wall
 * clock stored as if it were UTC, which read as four in the morning on any
 * phone in Maryland. Migration 0254 corrected the rows; this file is what
 * stops it happening again.
 */

/** The one zone this business works in. Settings carry it per business too. */
export const BUSINESS_TIME_ZONE = "America/New_York";

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{1,2}):(\d{2})$/;

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 is Sunday, like Date.getDay(). */
  weekday: number;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let found = formatters.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatters.set(timeZone, found);
  }
  return found;
}

/** What the clock on the wall says in that zone at this instant. */
export function wallClockIn(date: Date, timeZone: string = BUSINESS_TIME_ZONE): WallClock {
  const parts = formatter(timeZone).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: Math.max(0, WEEKDAYS.indexOf(get("weekday"))),
  };
}

/** "YYYY-MM-DD" of this instant, on that clock. */
export function dateKeyIn(date: Date, timeZone: string = BUSINESS_TIME_ZONE): string {
  const w = wallClockIn(date, timeZone);
  return `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
}

/** Minutes since midnight of this instant, on that clock. */
export function minutesIn(date: Date, timeZone: string = BUSINESS_TIME_ZONE): number {
  const w = wallClockIn(date, timeZone);
  return w.hour * 60 + w.minute;
}

/** How far that zone is from UTC at this instant, in minutes. New York in summer is -240. */
export function offsetMinutesAt(date: Date, timeZone: string = BUSINESS_TIME_ZONE): number {
  const w = wallClockIn(date, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return Math.round((asUtc - date.getTime()) / 60_000);
}

/**
 * The instant a wall-clock date and time mean in that zone.
 *
 * "2026-09-14" and "08:00" in New York is 12:00 UTC in September and 13:00
 * in December. Worked out from the offset in force at that moment, twice,
 * so a clock change on the day itself still lands on the right side of it.
 */
export function zonedToUtc(dateKey: string, time: string, timeZone: string = BUSINESS_TIME_ZONE): Date {
  const d = DATE_KEY.exec(dateKey);
  const t = TIME.exec(time);
  if (!d || !t) return new Date(NaN);
  const naive = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
  let guess = naive - offsetMinutesAt(new Date(naive), timeZone) * 60_000;
  guess = naive - offsetMinutesAt(new Date(guess), timeZone) * 60_000;
  return new Date(guess);
}

/**
 * A timestamp from outside, read the way the sender meant it.
 *
 * With an offset or a Z it is an instant already. Without one it is a wall
 * clock, and the only sensible clock is the business's.
 */
export function parseAsBusinessTime(raw: string, timeZone: string = BUSINESS_TIME_ZONE): Date {
  const trimmed = raw.trim();
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)) return new Date(trimmed);
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}:\d{2})/.exec(trimmed);
  if (m) return zonedToUtc(m[1], m[2], timeZone);
  return new Date(trimmed);
}

/** "Mon, Sep 14, 8:00 AM" on the business clock, wherever the server is. */
export function shortWhen(value: string | Date, timeZone: string = BUSINESS_TIME_ZONE): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return typeof value === "string" ? value : "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/** "8:00 AM" on the business clock. */
export function timeOnly(value: string | Date, timeZone: string = BUSINESS_TIME_ZONE): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(date);
}

/** "Monday, September 14" on the business clock. */
export function dayOnly(value: string | Date, timeZone: string = BUSINESS_TIME_ZONE): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "long", day: "numeric" }).format(date);
}

/** "Sep 13, 8:14 AM" on the business clock. */
export function monthDayTime(value: string | Date, timeZone: string = BUSINESS_TIME_ZONE): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

/** "Sep 13, 2026" on the business clock. */
export function dateShort(value: string | Date, timeZone: string = BUSINESS_TIME_ZONE): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", year: "numeric" }).format(date);
}

/** "Sat, Sep 13" on the business clock. */
export function weekdayDate(value: string | Date, timeZone: string = BUSINESS_TIME_ZONE): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" }).format(date);
}
