import { evaluationWindow, windowsOverlap, type Window } from "@/lib/scheduling";
import type { DayOff, WeeklyAvailability } from "@/types/domain";

export const SLOT_MINUTES = 60;

export interface BookedTime {
  evaluatorId: string;
  /** ISO timestamp of an existing evaluation already on that evaluator's calendar. */
  iso: string;
  /**
   * When that evaluation ends.
   *
   * Optional because rows written before evaluations had an end genuinely
   * don't know; those fall back to the default visit length. Without this the
   * check only blocked the exact matching slot, so the second hour of a
   * two-hour visit stayed bookable.
   */
  endIso?: string | null;
}

export interface AvailableSlotGroup {
  /** "YYYY-MM-DD" in the evaluator's local calendar day. */
  date: string;
  /** "HH:MM" 24-hour. */
  time: string;
  /** Every evaluator free at this exact date/time — booking picks one. */
  evaluatorIds: string[];
}

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60000);
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Computes bookable slots for the given evaluators over the next `daysAhead`
 * days, honoring each evaluator's weekly hours, days off (whole-day or a
 * specific time range), and anything already on their calendar. A slot needs
 * at least one evaluator free — the caller picks which one at booking time.
 */
export function computeAvailableSlots({
  evaluatorIds,
  weeklyAvailability,
  daysOff,
  bookedTimes,
  from,
  daysAhead = 14,
  slotMinutes = SLOT_MINUTES,
  minLeadMinutes = 60,
}: {
  evaluatorIds: string[];
  weeklyAvailability: WeeklyAvailability[];
  daysOff: DayOff[];
  bookedTimes: BookedTime[];
  from: Date;
  daysAhead?: number;
  slotMinutes?: number;
  minLeadMinutes?: number;
}): AvailableSlotGroup[] {
  const availabilityByEvaluator = new Map<string, WeeklyAvailability[]>();
  for (const a of weeklyAvailability) {
    if (!evaluatorIds.includes(a.profile_id)) continue;
    const list = availabilityByEvaluator.get(a.profile_id) ?? [];
    list.push(a);
    availabilityByEvaluator.set(a.profile_id, list);
  }

  const daysOffByEvaluator = new Map<string, DayOff[]>();
  for (const d of daysOff) {
    if (!evaluatorIds.includes(d.profile_id)) continue;
    const list = daysOffByEvaluator.get(d.profile_id) ?? [];
    list.push(d);
    daysOffByEvaluator.set(d.profile_id, list);
  }

  // Windows, not instants: an appointment occupies every slot it covers.
  const bookedByEvaluator = new Map<string, Window[]>();
  for (const b of bookedTimes) {
    const window = evaluationWindow(b.iso, b.endIso ?? null);
    if (!window) continue;
    const list = bookedByEvaluator.get(b.evaluatorId) ?? [];
    list.push(window);
    bookedByEvaluator.set(b.evaluatorId, list);
  }

  const earliestAllowed = addMinutes(from, minLeadMinutes);
  const groups = new Map<string, AvailableSlotGroup>();

  for (let offset = 0; offset < daysAhead; offset++) {
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset);
    const dateKey = toDateKey(day);
    const dow = day.getDay();

    for (const evaluatorId of evaluatorIds) {
      const windows = (availabilityByEvaluator.get(evaluatorId) ?? []).filter((a) => a.day_of_week === dow);
      if (windows.length === 0) continue;

      const evaluatorDaysOff = (daysOffByEvaluator.get(evaluatorId) ?? []).filter((d) => d.date === dateKey);
      const fullDayOff = evaluatorDaysOff.some((d) => !d.start_time || !d.end_time);
      if (fullDayOff) continue;
      const partialOffRanges = evaluatorDaysOff
        .filter((d) => d.start_time && d.end_time)
        .map((d) => ({ start: timeToMinutes(d.start_time!.slice(0, 5)), end: timeToMinutes(d.end_time!.slice(0, 5)) }));

      const booked = bookedByEvaluator.get(evaluatorId);

      for (const window of windows) {
        const startMin = timeToMinutes(window.start_time.slice(0, 5));
        const endMin = timeToMinutes(window.end_time.slice(0, 5));

        for (let slotStart = startMin; slotStart + slotMinutes <= endMin; slotStart += slotMinutes) {
          const slotEnd = slotStart + slotMinutes;
          const overlapsTimeOff = partialOffRanges.some((r) => slotStart < r.end && slotEnd > r.start);
          if (overlapsTimeOff) continue;

          const slotDate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0);
          const slotDateTime = addMinutes(slotDate, slotStart);
          if (slotDateTime < earliestAllowed) continue;

          const slotWindow = { start: slotDateTime, end: addMinutes(slotDateTime, slotMinutes) };
          const isBooked = (booked ?? []).some((b) => windowsOverlap(b, slotWindow));
          if (isBooked) continue;

          const timeLabel = `${String(Math.floor(slotStart / 60)).padStart(2, "0")}:${String(slotStart % 60).padStart(2, "0")}`;
          const key = `${dateKey}T${timeLabel}`;
          const existing = groups.get(key);
          if (existing) {
            existing.evaluatorIds.push(evaluatorId);
          } else {
            groups.set(key, { date: dateKey, time: timeLabel, evaluatorIds: [evaluatorId] });
          }
        }
      }
    }
  }

  return Array.from(groups.values()).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}
