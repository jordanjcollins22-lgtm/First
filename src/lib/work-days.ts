/**
 * The days a client is allowed to pick for their work.
 *
 * A client who has just paid wants a date, and the honest answer is not "we
 * will be in touch". It is the list of days the crew is actually free, with
 * the days we already know we will lose to rain taken off it.
 *
 * Two weeks is the horizon on purpose. That is as far as a forecast is worth
 * repeating to somebody, and it is as far ahead as the crew's day is really
 * planned. Past that a day is offered without a forecast rather than with a
 * guess dressed up as one.
 *
 * Pure functions on YYYY-MM-DD strings. Dates are handled as strings and read
 * back at midday UTC, because a Date built from a bare date string in a
 * negative timezone is the previous day, which is how a client picks Tuesday
 * and the crew turns up on Monday.
 */

/** How far ahead a forecast is shown. Also how far ahead we schedule. */
export const WEATHER_WINDOW_DAYS = 14;

/** How many days of choices to put in front of somebody. */
export const OFFER_DAYS = 45;

/** Crews per day. More starts than this on one day and the day is full. */
export const DEFAULT_CAPACITY = 2;

/** Chance of rain that takes a day off the list. */
export const RAIN_CHANCE_BLOCKS = 50;

/** Sunday off. Everything else is a working day unless told otherwise. */
export const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5, 6];

export interface DayWeather {
  date: string;
  /** Percent, 0 to 100. */
  precipChance: number;
  /** WMO code, so a thunderstorm blocks a day the chance alone would not. */
  code: number;
  label: string;
}

export interface WorkDayOption {
  date: string;
  /** "Tue, Sep 8" — what a person reads on a button. */
  label: string;
  status: "open" | "rain" | "full";
  /** Why it cannot be picked, in the client's words. Null when it can. */
  reason: string | null;
  /** Null past the forecast horizon, where we genuinely do not know. */
  precipChance: number | null;
  weatherLabel: string | null;
}

export interface WorkDaysInput {
  /** Today, in the crew's own timezone. */
  today: string;
  /**
   * The first day we are willing to start. Same as today for most, later for
   * a client whose discount is being protected until the plan is paid off.
   */
  earliest?: string;
  days?: number;
  capacityPerDay?: number;
  /** One entry per job already starting that day. */
  booked?: string[];
  weather?: DayWeather[];
  workingDays?: number[];
}

function addDays(date: string, count: number): string {
  const at = new Date(`${date}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + count);
  return at.toISOString().slice(0, 10);
}

function weekday(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Days between two dates, negative when the second is earlier. */
export function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00Z`).getTime();
  const b = new Date(`${to}T12:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** Whether we have a real forecast for a day, rather than a shrug. */
export function weatherIsKnown(today: string, date: string): boolean {
  const out = daysBetween(today, date);
  return out >= 0 && out < WEATHER_WINDOW_DAYS;
}

/**
 * Whether a forecast is bad enough to keep the crew off a property.
 *
 * Thunder and snow block regardless of the chance: a twenty percent chance of
 * a thunderstorm is still a day nobody is running equipment through.
 */
export function rainBlocks(day: DayWeather): boolean {
  if (day.code >= 95) return true;
  if (day.code >= 71 && day.code <= 77) return true;
  return day.precipChance >= RAIN_CHANCE_BLOCKS;
}

export function buildWorkDays(input: WorkDaysInput): WorkDayOption[] {
  const capacity = Math.max(1, input.capacityPerDay ?? DEFAULT_CAPACITY);
  const working = new Set(input.workingDays ?? DEFAULT_WORKING_DAYS);
  const span = Math.max(1, input.days ?? OFFER_DAYS);

  const forecast = new Map<string, DayWeather>();
  for (const day of input.weather ?? []) forecast.set(day.date, day);

  const load = new Map<string, number>();
  for (const date of input.booked ?? []) load.set(date, (load.get(date) ?? 0) + 1);

  // The later of "today" and whatever the payment path allows. A plan that
  // books a month after the final payment cannot offer next Tuesday.
  const earliest = input.earliest && input.earliest > input.today ? input.earliest : input.today;

  const options: WorkDayOption[] = [];
  for (let i = 0; i < span; i += 1) {
    const date = addDays(earliest, i);
    if (!working.has(weekday(date))) continue;

    const known = weatherIsKnown(input.today, date);
    const day = known ? forecast.get(date) : undefined;

    let status: WorkDayOption["status"] = "open";
    let reason: string | null = null;

    if ((load.get(date) ?? 0) >= capacity) {
      status = "full";
      reason = "Fully booked";
    } else if (day && rainBlocks(day)) {
      status = "rain";
      reason = "Blocked off, rain likely";
    }

    options.push({
      date,
      label: dayLabel(date),
      status,
      reason,
      precipChance: day ? day.precipChance : null,
      weatherLabel: day ? day.label : null,
    });
  }
  return options;
}

export function openDays(options: WorkDayOption[]): WorkDayOption[] {
  return options.filter((o) => o.status === "open");
}

/** The soonest day they can have, which is the one to put first. */
export function firstOpenDay(options: WorkDayOption[]): WorkDayOption | null {
  return openDays(options)[0] ?? null;
}

/**
 * What to say above the list.
 *
 * Names the rain rule up front, because a client who sees three greyed-out
 * days and no explanation assumes we are busy and rings up to complain.
 */
export function windowNote(options: WorkDayOption[]): string {
  const rained = options.filter((o) => o.status === "rain").length;
  if (rained === 0) return "Pick the day that suits you and we will hold the crew for it.";
  return (
    `Pick the day that suits you. ${rained === 1 ? "One day is" : `${rained} days are`} ` +
    "blocked off for now because rain is forecast, and we will open them back up if it clears."
  );
}
