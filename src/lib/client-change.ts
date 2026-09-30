/**
 * The client rang to move or call off today's visit: the new times, worked
 * out the same way whichever card the account manager pressed it on.
 *
 * An evaluation moves as a window, keeping how long it was booked for. A
 * work visit moves as days, keeping how many days it runs. Nothing can be
 * moved into the past, and calling one off always says why.
 *
 * Pure, so the arithmetic is tested without a clock or a database.
 */

import { dateKeyIn, zonedToUtc } from "@/lib/time-zone";

export type ChangeCheck<T> = { ok: true; value: T } | { ok: false; reason: string };

const DAY = 86_400_000;
const DEFAULT_EVALUATION_MINUTES = 60;

/** The evaluation's new window: the new start, and the same length as before. */
export function movedEvaluation(
  before: { start: string; end: string | null },
  date: string,
  time: string,
  now: Date
): ChangeCheck<{ start: string; end: string }> {
  const start = zonedToUtc(date, time);
  if (Number.isNaN(start.getTime())) return { ok: false, reason: "Pick the new day and time." };
  if (start.getTime() <= now.getTime()) return { ok: false, reason: "That time has already gone. Pick a later one." };
  const was = new Date(before.start).getTime();
  const wasEnd = before.end ? new Date(before.end).getTime() : NaN;
  const length = Number.isFinite(was) && Number.isFinite(wasEnd) && wasEnd > was ? wasEnd - was : DEFAULT_EVALUATION_MINUTES * 60_000;
  return { ok: true, value: { start: start.toISOString(), end: new Date(start.getTime() + length).toISOString() } };
}

/** The work visit's new days: starting on the new day, running as many days as before. */
export function movedVisit(before: { startsOn: string; endsOn: string }, date: string, now: Date): ChangeCheck<{ startsOn: string; endsOn: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, reason: "Pick the new day." };
  if (date < dateKeyIn(now)) return { ok: false, reason: "That day has already gone. Pick a later one." };
  const days = Math.max(0, Math.round((Date.parse(`${before.endsOn}T12:00:00Z`) - Date.parse(`${before.startsOn}T12:00:00Z`)) / DAY));
  const endsOn = new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);
  return { ok: true, value: { startsOn: date, endsOn } };
}

/** Why it was called off, kept on the record in the client's words. */
export function cancelNote(reason: string): ChangeCheck<string> {
  const said = reason.trim();
  if (said.length < 3) return { ok: false, reason: "Say why they called it off, so it's on the record." };
  return { ok: true, value: `Client called it off: ${said}`.slice(0, 500) };
}
