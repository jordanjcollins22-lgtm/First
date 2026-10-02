/**
 * Speed to lead. Somebody who just asked for a price, or just paid, is
 * called within two minutes: that is when they are still holding the phone.
 * Pure, so the clock is tested without a database.
 */
export const CALL_WITHIN_MINUTES = 2;

export function callClock(since: string, now: Date = new Date()): { minutes: number; overdue: boolean; label: string } {
  const minutes = Math.max(0, (now.getTime() - new Date(since).getTime()) / 60_000);
  const overdue = minutes > CALL_WITHIN_MINUTES;
  if (!overdue) return { minutes, overdue, label: "Call now" };
  if (minutes < 60) {
    const m = Math.round(minutes);
    return { minutes, overdue, label: `${m} min waiting` };
  }
  if (minutes < 48 * 60) {
    const h = Math.round(minutes / 60);
    return { minutes, overdue, label: `${h} hr${h === 1 ? "" : "s"} waiting` };
  }
  const d = Math.round(minutes / 1440);
  return { minutes, overdue, label: `${d} days waiting` };
}

/** Whether a call came within the two minutes. Null when nobody has called. */
export function calledInTime(since: string | null, calledAt: string | null): boolean | null {
  if (!since || !calledAt) return null;
  return new Date(calledAt).getTime() - new Date(since).getTime() <= CALL_WITHIN_MINUTES * 60_000;
}
