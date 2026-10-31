import { BUSINESS_TIME_ZONE, dateKeyIn } from "@/lib/time-zone";

/**
 * The days a deposit client can pick to start: from tomorrow, for three
 * weeks, skipping Sundays. A preference, not a booking: the team confirms the
 * day with them, so it doesn't need to know which crew is free.
 */
export const START_DAY_WINDOW = 21;

export function startDayOptions(now: Date, timeZone: string = BUSINESS_TIME_ZONE): string[] {
  const days: string[] = [];
  for (let i = 1; days.length < START_DAY_WINDOW && i < START_DAY_WINDOW * 2; i++) {
    const key = dateKeyIn(new Date(now.getTime() + i * 86_400_000), timeZone);
    const [y, m, d] = key.split("-").map(Number);
    if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 0) continue;
    if (!days.includes(key)) days.push(key);
  }
  return days.slice(0, START_DAY_WINDOW);
}

export function isStartDayOption(day: unknown, now: Date, timeZone?: string): day is string {
  return typeof day === "string" && startDayOptions(now, timeZone).includes(day);
}
