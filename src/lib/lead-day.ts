/**
 * The project lead's view of their crew today, worked out without a database.
 *
 * One plain answer per person: here, on the way, not in yet, late, or done.
 * "Late" means past the shop's start time with nothing from them yet, which
 * is the one the lead has to act on, so it sorts first.
 */

import { readDay, type CrewEvent, type Stop } from "@/lib/crew-day";
import { sayTime } from "@/lib/sub-crew";
import { BUSINESS_TIME_ZONE, wallClockIn } from "@/lib/time-zone";

export type CrewTone = "late" | "waiting" | "moving" | "here" | "done";

export interface CrewStatus {
  tone: CrewTone;
  label: string;
}

/** Minutes after midnight of "07:00" or "07:00:00"; null when it can't be read. */
export function minutesOf(time: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(time ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Where one person on the lead's jobs is, in a few words. */
export function crewMemberStatus(input: {
  events: CrewEvent[];
  stops: Stop[];
  /** When the crew is due, "HH:MM", or null when the business hasn't set one. */
  arriveBy: string | null;
  now: Date;
  timeZone?: string;
}): CrewStatus {
  const { events, stops, arriveBy, now, timeZone = BUSINESS_TIME_ZONE } = input;

  // Nothing from them yet today: not in, or late once the start time has passed.
  if (events.length === 0) {
    const due = minutesOf(arriveBy);
    const clock = wallClockIn(now, timeZone);
    const nowMin = clock.hour * 60 + clock.minute;
    const said = sayTime(arriveBy);
    if (due != null && nowMin > due) return { tone: "late", label: said ? `Late, due at ${said}` : "Late" };
    return { tone: "waiting", label: said ? `Not in yet, due at ${said}` : "Not in yet" };
  }

  const day = readDay(events, stops);
  const at = day.currentStop?.customerName;
  switch (day.phase) {
    case "day_over":
      return { tone: "done", label: "Done for the day" };
    case "on_site":
      return { tone: "here", label: at ? `On site at ${at}` : "On site" };
    case "travelling":
      return { tone: "moving", label: at ? `On the way to ${at}` : "On the way" };
    case "at_shop":
      return { tone: "here", label: "At the shop" };
    case "between_stops":
      return { tone: "moving", label: "Between stops" };
    case "stops_done":
      return { tone: "moving", label: "Stops done, heading back" };
    case "before_shop":
      return { tone: "waiting", label: "Not at the shop yet" };
  }
}

const ORDER: Record<CrewTone, number> = { late: 0, waiting: 1, moving: 2, here: 3, done: 4 };

/** Late first, done last, then by name: the one to chase is at the top. */
export function sortCrew<T extends { name: string; status: CrewStatus }>(people: T[]): T[] {
  return [...people].sort((a, b) => ORDER[a.status.tone] - ORDER[b.status.tone] || a.name.localeCompare(b.name));
}
