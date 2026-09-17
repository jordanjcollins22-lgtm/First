/**
 * Whether somebody on today's schedule has used the app today.
 *
 * A crew member who has not opened the app is invisible: no taps, no dot
 * on the map, no ticks on the load-out. The office used to find that out
 * at the first phone call. Now it is a fact on their card and, past a
 * cut-off in the morning, a text to whoever runs the day, so the
 * conversation happens while it still changes the day.
 */

import { BUSINESS_TIME_ZONE, dateKeyIn } from "@/lib/time-zone";

/** Nobody is chased before this, in business time. Trucks leave at eight. */
export const QUIET_CUTOFF_MINUTES = 8 * 60 + 30;

export interface PresenceInput {
  day: string;
  /** Every tap on the crew screen today. */
  eventsToday: number;
  /** Ticks on the load-out today. */
  checksToday: number;
  /** When the phone last reported, whenever that was. */
  positionAt: string | null;
}

export interface Presence {
  seenToday: boolean;
  /** The last sign of them, today or before. */
  lastSeenAt: string | null;
  /** Scheduled, past the cut-off, and nothing from them. */
  quiet: boolean;
}

function minutesIntoDay(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

export function presenceOf(input: PresenceInput, now: Date = new Date(), timeZone: string = BUSINESS_TIME_ZONE): Presence {
  const positionToday = input.positionAt != null && dateKeyIn(new Date(input.positionAt), timeZone) === input.day;
  const seenToday = input.eventsToday > 0 || input.checksToday > 0 || positionToday;
  const isToday = dateKeyIn(now, timeZone) === input.day;
  const pastCutoff = isToday && minutesIntoDay(now, timeZone) >= QUIET_CUTOFF_MINUTES;
  return {
    seenToday,
    lastSeenAt: input.positionAt,
    quiet: !seenToday && pastCutoff,
  };
}

/** "Shalon hasn't opened the app today. First stop: Matthew Schautz." */
export function quietLine(name: string, firstStop: string | null): string {
  return `${name} hasn't opened the app today.${firstStop ? ` First stop: ${firstStop}.` : ""}`;
}
