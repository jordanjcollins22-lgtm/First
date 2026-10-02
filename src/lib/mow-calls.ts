/**
 * How the 24-hour promise stands for one paid mow. Pure, so the clock is
 * tested without a database.
 */
export const CALL_WITHIN_HOURS = 24;

export function callClock(paidAt: string, now: Date = new Date()): { hoursLeft: number; overdue: boolean; label: string } {
  const elapsed = (now.getTime() - new Date(paidAt).getTime()) / 3_600_000;
  const hoursLeft = CALL_WITHIN_HOURS - elapsed;
  if (hoursLeft <= 0) {
    const late = Math.max(1, Math.round(-hoursLeft));
    return { hoursLeft, overdue: true, label: `${late} hr${late === 1 ? "" : "s"} past the 24` };
  }
  const left = Math.max(1, Math.floor(hoursLeft));
  return { hoursLeft, overdue: false, label: `${left} hr${left === 1 ? "" : "s"} left to call` };
}
