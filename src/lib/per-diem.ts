/**
 * What a day of work has to earn before the business has made anything.
 *
 * Quotes carry a flat ten percent for overhead. It is a guess, it has never
 * been checked against anything, and it is the same ten percent whether a job
 * takes an afternoon or a fortnight — which is exactly backwards, because
 * overhead is a cost of time passing, not of work done. A two-week job ties up
 * two weeks of rent, insurance and software whatever its materials cost.
 *
 * The real number is known now: it comes off the bank. So the per diem turns
 * that monthly figure into what one crew-day has to carry, and a job carries
 * one for every day it takes.
 *
 * Three assumptions go into it, and all three are somebody's judgement rather
 * than a fact. How many days a month the crew is actually earning, how long a
 * day is, and how many of them there are. They are stated out loud and
 * editable, because a per diem is only as honest as the days you admit to
 * losing — count all twenty-two working days and you will under-recover every
 * time it rains.
 */

export interface WorkingPattern {
  /**
   * Days a month the crew is on a paying job.
   *
   * Not working days. Rain, quoting, breakdowns, loading and the drive are
   * real and are not on anybody's invoice. Around eighteen of twenty-two is a
   * sane starting point for a crew that also sells and maintains its own kit.
   */
  billableDaysPerMonth: number;
  /** Hours on site in one of those days. */
  hoursPerDay: number;
  /** How many people go out. Overhead does not scale with the crew, so this
   * only converts between crew-hours and days. */
  crewSize: number;
}

export const DEFAULT_PATTERN: WorkingPattern = {
  billableDaysPerMonth: 18,
  hoursPerDay: 8,
  crewSize: 2,
};

export interface PerDiem {
  /** What one day on site has to carry. */
  perDay: number;
  /**
   * The same, per crew-hour.
   *
   * What the quote actually multiplies by, because a quote knows its hours and
   * not its days. Set so that a full crew for a full day comes to exactly one
   * per diem: a bigger crew does not pay more overhead for the same day,
   * because the rent does not care how many people are in the van.
   */
  perCrewHour: number;
  /** Per calendar month, which is where the figure came from. */
  perMonth: number;
  perYear: number;
  /** Crew-hours a month the overhead is being spread across. */
  crewHoursPerMonth: number;
}

/**
 * The overhead, per day and per crew-hour.
 *
 * Returns zeroes rather than dividing by nothing when the pattern is empty. A
 * quote built on an infinite per diem is not a quote anybody can send, and a
 * crash here would take the pricing down with it.
 */
export function perDiemFrom(monthlyOverhead: number, pattern: WorkingPattern): PerDiem {
  const days = Math.max(0, pattern.billableDaysPerMonth);
  const hours = Math.max(0, pattern.hoursPerDay);
  const crew = Math.max(0, pattern.crewSize);
  const crewHoursPerMonth = days * hours * crew;

  if (days <= 0 || crewHoursPerMonth <= 0) {
    return { perDay: 0, perCrewHour: 0, perMonth: round(monthlyOverhead), perYear: round(monthlyOverhead * 12), crewHoursPerMonth: 0 };
  }

  return {
    perDay: round(monthlyOverhead / days),
    perCrewHour: round(monthlyOverhead / crewHoursPerMonth),
    perMonth: round(monthlyOverhead),
    perYear: round(monthlyOverhead * 12),
    crewHoursPerMonth,
  };
}

/** What one line of the overhead costs per day, for a breakdown somebody reads. */
export interface PerDiemLine {
  label: string;
  monthly: number;
  perDay: number;
  /** Share of the per diem, for seeing what dominates it. */
  share: number;
}

export function perDiemLines(
  groups: readonly { label: string; monthly: number }[],
  pattern: WorkingPattern
): PerDiemLine[] {
  const days = Math.max(1, pattern.billableDaysPerMonth);
  const total = groups.reduce((sum, group) => sum + group.monthly, 0);

  return groups
    .map((group) => ({
      label: group.label,
      monthly: round(group.monthly),
      perDay: round(group.monthly / days),
      share: total > 0 ? Math.round((group.monthly / total) * 100) / 100 : 0,
    }))
    .sort((a, b) => b.perDay - a.perDay);
}

/**
 * What a job of this size owes the overhead.
 *
 * Charged on crew-hours because that is what a quote knows. A three-person
 * crew for one day is twenty-four crew-hours and one per diem, which is the
 * whole point of setting the hourly rate the way it is set.
 */
export function overheadForJob(crewHours: number, perDiem: PerDiem): number {
  if (crewHours <= 0) return 0;
  return round(crewHours * perDiem.perCrewHour);
}

/** Roughly how many days on site that is, for saying it in a sentence. */
export function daysForJob(crewHours: number, pattern: WorkingPattern): number {
  const perDay = Math.max(1, pattern.hoursPerDay * Math.max(1, pattern.crewSize));
  return Math.round((crewHours / perDay) * 10) / 10;
}

/**
 * What the flat percentage was actually charging, for comparing the two.
 *
 * The honest way to introduce a per diem: show what the old rule collected on
 * this job beside what the real overhead costs. On a short job with expensive
 * materials the percentage over-charges; on a long job with cheap materials it
 * collects almost nothing, which is the case that has been quietly losing
 * money.
 */
export function flatOverheadFor(directCost: number, multiplier: number, percent: number): number {
  return round(directCost * multiplier * (percent / 100));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
