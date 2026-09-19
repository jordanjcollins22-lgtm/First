/**
 * The days nobody should be booked to work, worked out rather than listed.
 *
 * A hardcoded list of dates is right until January, and then it is quietly
 * wrong for a year. Every holiday here is computed from its rule, so the
 * calendar is correct in 2030 without anybody remembering to update it.
 *
 * Two kinds, because they are two different mistakes:
 *
 *  - Federal holidays. Nobody works. Booking a crew on Labor Day is the
 *    mistake this file exists to stop.
 *  - Observances. The business may well work them, but somebody deciding
 *    should know: a garden crew turning up on Mother's Day morning is a
 *    different conversation to one turning up on a Tuesday.
 *
 * Federal holidays move off weekends and observances do not. When the Fourth
 * of July falls on a Saturday the day off is the Friday, and it is the Friday
 * that must not be booked -- so both dates are carried, and a lookup finds a
 * holiday by either.
 *
 * All dates are "YYYY-MM-DD" strings built in UTC. Constructing a Date from a
 * local-time year/month/day and formatting it back shifts the day either side
 * of midnight depending on where the browser is, which is how a holiday lands
 * on the fourth for the office and the third for somebody in the field.
 */

export type HolidayKind = "federal" | "observance";

export interface Holiday {
  name: string;
  /** The date of the holiday itself, "YYYY-MM-DD". */
  date: string;
  /**
   * The weekday it is taken off. Same as `date` except for a federal holiday
   * that falls at a weekend.
   */
  observed: string;
  kind: HolidayKind;
}

function key(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The day of the month for the nth given weekday. Sunday is 0. */
function nthWeekday(year: number, month: number, weekday: number, n: number): number {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const shift = (weekday - first.getUTCDay() + 7) % 7;
  return 1 + shift + (n - 1) * 7;
}

/** The day of the month for the last given weekday. */
function lastWeekday(year: number, month: number, weekday: number): number {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = new Date(Date.UTC(year, month - 1, lastDay));
  return lastDay - ((last.getUTCDay() - weekday + 7) % 7);
}

/** The same date, moved by whole days. */
function shiftDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const moved = new Date(Date.UTC(y, m - 1, d + days));
  return key(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate());
}

/**
 * When a federal holiday is actually taken off.
 *
 * Saturday moves back to the Friday, Sunday forward to the Monday. This is why
 * a lookup has to match on both dates: the holiday is the fourth, the day off
 * is the third, and it is the third the crew are not available.
 */
function observedFor(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (weekday === 6) return shiftDays(dateKey, -1);
  if (weekday === 0) return shiftDays(dateKey, 1);
  return dateKey;
}

/**
 * Easter Sunday, by the anonymous Gregorian computus.
 *
 * Here because Good Friday and Easter weekend are the two spring dates a home
 * services business is asked about most, and neither can be written down as a
 * rule about weekdays.
 */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return key(year, month, day);
}

function federal(name: string, dateKey: string): Holiday {
  return { name, date: dateKey, observed: observedFor(dateKey), kind: "federal" };
}

function observance(name: string, dateKey: string): Holiday {
  // Observances do not move. Mother's Day is a Sunday by definition, and
  // Christmas Eve on a Saturday is still Christmas Eve.
  return { name, date: dateKey, observed: dateKey, kind: "observance" };
}

/** Every holiday in a year, in date order. */
export function holidaysInYear(year: number): Holiday[] {
  const easter = easterSunday(year);
  const thanksgiving = key(year, 11, nthWeekday(year, 11, 4, 4));

  const holidays: Holiday[] = [
    federal("New Year's Day", key(year, 1, 1)),
    federal("Martin Luther King Jr. Day", key(year, 1, nthWeekday(year, 1, 1, 3))),
    federal("Presidents' Day", key(year, 2, nthWeekday(year, 2, 1, 3))),
    observance("Good Friday", shiftDays(easter, -2)),
    observance("Easter Sunday", easter),
    observance("Mother's Day", key(year, 5, nthWeekday(year, 5, 0, 2))),
    federal("Memorial Day", key(year, 5, lastWeekday(year, 5, 1))),
    observance("Father's Day", key(year, 6, nthWeekday(year, 6, 0, 3))),
    federal("Juneteenth", key(year, 6, 19)),
    federal("Independence Day", key(year, 7, 4)),
    federal("Labor Day", key(year, 9, nthWeekday(year, 9, 1, 1))),
    federal("Columbus Day", key(year, 10, nthWeekday(year, 10, 1, 2))),
    observance("Halloween", key(year, 10, 31)),
    federal("Veterans Day", key(year, 11, 11)),
    federal("Thanksgiving", thanksgiving),
    observance("Day after Thanksgiving", shiftDays(thanksgiving, 1)),
    observance("Christmas Eve", key(year, 12, 24)),
    federal("Christmas Day", key(year, 12, 25)),
    observance("New Year's Eve", key(year, 12, 31)),
  ];

  return holidays.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Whatever falls on one date, by either its own date or the day it is
 * observed.
 *
 * Neighbouring years are searched as well, because New Year's Day falling on a
 * Saturday is observed on the last Friday of the year before it -- a day off
 * that belongs to a year the holiday is not in.
 */
export function holidaysOn(dateKey: string): Holiday[] {
  const year = Number(dateKey.slice(0, 4));
  if (!Number.isFinite(year)) return [];

  return [year - 1, year, year + 1]
    .flatMap(holidaysInYear)
    .filter((holiday) => holiday.date === dateKey || holiday.observed === dateKey);
}

/** Whether the business would normally be closed on this date. */
export function isClosedDay(dateKey: string): boolean {
  return holidaysOn(dateKey).some((holiday) => holiday.kind === "federal");
}

/**
 * What to say to somebody about to book this day, or nothing.
 *
 * A sentence rather than a flag, because it is read once at the moment of
 * booking and the useful part is which holiday it is. "Labor Day" stops the
 * booking; "a holiday" sends them to look it up.
 */
export function bookingWarning(dateKey: string): string | null {
  const found = holidaysOn(dateKey);
  if (found.length === 0) return null;

  const closed = found.filter((holiday) => holiday.kind === "federal");
  const names = (list: Holiday[]) => list.map((holiday) => holiday.name).join(" and ");

  if (closed.length > 0) {
    // The day off, when it is not the holiday itself, is the thing somebody
    // needs told: "observed" is why the crew are not in on the third.
    const shifted = closed.filter((holiday) => holiday.observed === dateKey && holiday.date !== dateKey);
    if (shifted.length > 0) return `${names(shifted)} is observed on this day. Nobody is working.`;
    return `${names(closed)}. Nobody is working.`;
  }

  return `${names(found)}. Worth checking before booking a crew.`;
}

/**
 * Every holiday between two dates, inclusive of both ends.
 *
 * A job booked to run Monday to Friday has to know about the Thursday, and
 * checking only the day it starts on is how a crew is promised for a week that
 * contains Thanksgiving. Matches on the observed day as well as the date, for
 * the same reason a single-day lookup does.
 *
 * An end before the start is treated as no range at all rather than swapped:
 * two dates the wrong way round is somebody mid-edit, and inventing a range
 * from it would warn about days nobody has chosen.
 */
export function holidaysBetween(startKey: string, endKey: string): Holiday[] {
  if (!startKey || !endKey || endKey < startKey) return [];

  const from = Number(startKey.slice(0, 4));
  const to = Number(endKey.slice(0, 4));
  if (!Number.isFinite(from) || !Number.isFinite(to)) return [];

  const years: number[] = [];
  for (let year = from - 1; year <= to + 1; year++) years.push(year);

  return years
    .flatMap(holidaysInYear)
    .filter((holiday) => {
      const on = holiday.observed;
      return on >= startKey && on <= endKey;
    })
    .sort((a, b) => a.observed.localeCompare(b.observed));
}
