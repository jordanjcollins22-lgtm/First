import { dateKeyIn } from "@/lib/time-zone";

/**
 * The days somebody can pick for their first mow. Tomorrow onward, for the
 * next couple of weeks, never a Sunday, and never a day already holding as
 * many first mows as the business takes in a day. Pure, so it is tested
 * without a calendar.
 */

/** How far ahead the page offers days. */
export const MOW_DAYS_AHEAD = 12;

/** Days of the week we don't mow, 0 being Sunday. */
const CLOSED_WEEKDAYS = new Set([0]);

export interface MowDay {
  /** YYYY-MM-DD on the business clock. */
  date: string;
  /** "Tue, Oct 6". */
  label: string;
  spotsLeft: number;
}

function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

function weekday(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function dayLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * Open days from tomorrow on the business clock. `booked` counts first mows
 * already on each day; a day at the limit is left out rather than shown full,
 * so the choice is only ever between days that can be had.
 */
export function openMowDays(now: Date, booked: Record<string, number>, perDay: number, ahead: number = MOW_DAYS_AHEAD): MowDay[] {
  const today = dateKeyIn(now);
  const out: MowDay[] = [];
  for (let i = 1; i <= ahead; i++) {
    const date = addDays(today, i);
    if (CLOSED_WEEKDAYS.has(weekday(date))) continue;
    const left = perDay - (booked[date] ?? 0);
    if (left <= 0) continue;
    out.push({ date, label: dayLabel(date), spotsLeft: left });
  }
  return out;
}

export function isOpenDay(date: string, days: MowDay[]): boolean {
  return days.some((d) => d.date === date);
}
