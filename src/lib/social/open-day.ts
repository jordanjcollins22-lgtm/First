/**
 * The next open day for a post.
 *
 * One post a day on the page at most: a day that already has a post on
 * Facebook (scheduled there or already out) is taken. The time is the
 * business's best slot for that weekday when it has one, otherwise 10 AM,
 * on the business's clock.
 *
 * Facebook only takes a scheduled time between ten minutes and about a month
 * ahead, so the search starts tomorrow and gives up after 28 days.
 */

import { BUSINESS_TIME_ZONE, dateKeyIn, wallClockIn, zonedToUtc } from "@/lib/time-zone";

export interface CadenceSlot {
  weekday: number;
  hour: number;
}

export const DEFAULT_HOUR = 10;
export const MAX_DAYS_AHEAD = 28;

/** The hour to post on this weekday: the first matching best-time slot, or 10 AM. */
export function hourFor(weekday: number, slots: readonly CadenceSlot[]): number {
  const slot = slots.find((s) => s.weekday === weekday && Number.isInteger(s.hour) && s.hour >= 0 && s.hour <= 23);
  return slot ? slot.hour : DEFAULT_HOUR;
}

/** Slots as saved, cleaned up: anything malformed is dropped. */
export function readSlots(raw: unknown): CadenceSlot[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s) => ({ weekday: Number((s as CadenceSlot)?.weekday), hour: Number((s as CadenceSlot)?.hour) }))
    .filter((s) => Number.isInteger(s.weekday) && s.weekday >= 0 && s.weekday <= 6 && Number.isInteger(s.hour) && s.hour >= 0 && s.hour <= 23);
}

/**
 * The first day from tomorrow with nothing on it, and the instant to post.
 * `taken` holds "YYYY-MM-DD" keys on the business clock. Null when the next
 * four weeks are full.
 */
export function nextOpenSlot(input: {
  now: Date;
  taken: ReadonlySet<string>;
  slots: readonly CadenceSlot[];
  timeZone?: string;
}): { dateKey: string; at: Date } | null {
  const zone = input.timeZone ?? BUSINESS_TIME_ZONE;
  const today = dateKeyIn(input.now, zone);
  for (let ahead = 1; ahead <= MAX_DAYS_AHEAD; ahead += 1) {
    // Noon UTC on today's date plus `ahead` days never slips a day either way.
    const [y, m, d] = today.split("-").map(Number);
    const probe = new Date(Date.UTC(y, m - 1, d + ahead, 12));
    const key = probe.toISOString().slice(0, 10);
    if (input.taken.has(key)) continue;
    const weekday = wallClockIn(zonedToUtc(key, "12:00", zone), zone).weekday;
    const hour = hourFor(weekday, input.slots);
    const at = zonedToUtc(key, `${String(hour).padStart(2, "0")}:00`, zone);
    if (at.getTime() - input.now.getTime() < 15 * 60_000) continue;
    return { dateKey: key, at };
  }
  return null;
}
