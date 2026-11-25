/** Crews work Monday to Saturday. Dates are YYYY-MM-DD. */
const DAY = 86_400_000;
const at = (key: string) => new Date(`${key}T12:00:00Z`);
const key = (d: Date) => d.toISOString().slice(0, 10);

/** The day `n` work days after `from` (Sundays skipped). `from` itself counts as day 0. */
export function addWorkDays(from: string, n: number): string {
  let d = at(from);
  if (d.getUTCDay() === 0) d = new Date(d.getTime() + DAY);
  for (let left = n; left > 0; ) {
    d = new Date(d.getTime() + DAY);
    if (d.getUTCDay() !== 0) left--;
  }
  return key(d);
}

/** The next work day after `today`. */
export function nextWorkDay(today: string): string {
  return addWorkDays(today, 1);
}
