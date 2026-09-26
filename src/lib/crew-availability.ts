/**
 * Whether somebody works the days a job is booked for.
 *
 * A person's weekly hours say which days they work. Somebody who has not set
 * any is taken as available every day, because a crew member nobody has set
 * up yet should not make every booking fail; somebody who has set them is
 * taken at their word.
 *
 * Pure, so the rule is tested without a database.
 */

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Every YYYY-MM-DD from start to end, inclusive. */
function eachDay(startsOn: string, endsOn: string): string[] {
  const out: string[] = [];
  const d = new Date(`${startsOn}T12:00:00Z`);
  const end = new Date(`${endsOn}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || Number.isNaN(end.getTime())) return out;
  while (d <= end && out.length < 60) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** The days in the booking this person does not work, by their weekly hours. */
export function daysNotWorked(weekly: readonly { day_of_week: number }[], startsOn: string, endsOn: string): string[] {
  if (weekly.length === 0) return [];
  const works = new Set(weekly.map((w) => w.day_of_week));
  return eachDay(startsOn, endsOn).filter((day) => !works.has(new Date(`${day}T12:00:00Z`).getUTCDay()));
}

/** "Max doesn't work Saturdays." */
export function describeDayNotWorked(name: string, day: string): string {
  const weekday = WEEKDAYS[new Date(`${day}T12:00:00Z`).getUTCDay()];
  return `${name} doesn't work ${weekday}s. Their hours are on their My Day, under My schedule.`;
}
