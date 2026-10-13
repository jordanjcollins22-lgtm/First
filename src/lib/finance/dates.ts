/**
 * Calendar days in the business's own time zone. Money is counted by the
 * day it happened in Maryland, not in UTC: a payment at 9pm on the 31st
 * belongs to that month, not the next.
 */
export const BUSINESS_TZ = "America/New_York";

/** "YYYY-MM-DD" for an instant, in the given zone. */
export function localDay(at: string | Date, tz = BUSINESS_TZ): string {
  const d = typeof at === "string" ? new Date(at) : at;
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Adds whole days to a "YYYY-MM-DD", returning the same form. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** Whole days from one "YYYY-MM-DD" to another (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  const ms = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(b) - ms(a)) / 86_400_000);
}

/** The Monday on or before a day. Payroll weeks run Monday to Sunday. */
export function mondayOf(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 Sunday
  return addDays(day, dow === 0 ? -6 : 1 - dow);
}

export type Period = "week" | "month" | "ytd";

/** The first day of the week (Monday), month or year that `today` is in. */
export function periodStart(today: string, period: Period): string {
  if (period === "week") return mondayOf(today);
  if (period === "month") return `${today.slice(0, 7)}-01`;
  return `${today.slice(0, 4)}-01-01`;
}

/** Whether a day falls in [from, to] inclusive. */
export function inRange(day: string, from: string, to: string): boolean {
  return day >= from && day <= to;
}
