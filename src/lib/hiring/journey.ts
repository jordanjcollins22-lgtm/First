import { addBusinessDays } from "@/lib/hr/onboarding";

/**
 * A new hire's way from day one to fully operating, from the hiring
 * structure (steps 13 to 21) and Alex Hormozi's three levels.
 *
 * - 14 and 20: check-ins twice a day for the first two weeks, then tapering
 * - 15 to 18: each task documented, demonstrated, duplicated, then released
 * - 19: reviews at days 30, 60 and 90 against the 30-60-90 plan
 * - 21: fully operating once check-ins are down to regular one-on-ones
 * - levels: individual contributor (knows what), manager (teaches how), leader (builds the system that teaches)
 *
 * Pure, so the dates and rules are tested without a database.
 */

const DAY = 86_400_000;

function dayNumber(startDate: string, today: string): number {
  const a = Date.parse(`${startDate.slice(0, 10)}T12:00:00Z`);
  const b = Date.parse(`${today.slice(0, 10)}T12:00:00Z`);
  return Math.floor((b - a) / DAY) + 1;
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso.slice(0, 10)}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

function isWeekday(iso: string): boolean {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`).getUTCDay();
  return d !== 0 && d !== 6;
}

// ---------------------------------------------------------------------------
// Check-ins (14, 20)
// ---------------------------------------------------------------------------

export type CheckInPhase = "twice_daily" | "daily" | "twice_weekly" | "one_on_one";

export const PHASE_LABEL: Record<CheckInPhase, string> = {
  twice_daily: "Twice a day (first two weeks)",
  daily: "Once a day (weeks 3 and 4)",
  twice_weekly: "Twice a week (to day 60)",
  one_on_one: "Weekly one-on-one",
};

/** The last day of each phase, from the first day of work. */
export function phaseEnds(startDate: string): { twiceDaily: string; daily: string; twiceWeekly: string } {
  const start = startDate.slice(0, 10);
  // The first day counts as a work day, so ten work days end nine business days later.
  const twiceDaily = isWeekday(start) ? addBusinessDays(start, 9) : addBusinessDays(start, 10);
  const daily = addBusinessDays(twiceDaily, 10);
  const twiceWeekly = addDays(start, 59);
  return { twiceDaily, daily, twiceWeekly };
}

export function phaseOn(startDate: string, date: string): CheckInPhase {
  const ends = phaseEnds(startDate);
  const d = date.slice(0, 10);
  if (d <= ends.twiceDaily) return "twice_daily";
  if (d <= ends.daily) return "daily";
  if (d <= ends.twiceWeekly) return "twice_weekly";
  return "one_on_one";
}

export interface CheckInSlot {
  /** Unique per hire: the date and the slot. */
  key: string;
  date: string;
  label: string;
  phase: CheckInPhase;
}

/** The check-ins due on one date, if any. Weekends have none. */
export function checkInsOn(startDate: string, date: string): CheckInSlot[] {
  const d = date.slice(0, 10);
  if (d < startDate.slice(0, 10) || !isWeekday(d)) return [];
  const phase = phaseOn(startDate, d);
  const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
  if (phase === "twice_daily") {
    return [
      { key: `${d}-am`, date: d, label: "Morning check-in", phase },
      { key: `${d}-pm`, date: d, label: "End-of-day check-in", phase },
    ];
  }
  if (phase === "daily") return [{ key: `${d}-day`, date: d, label: "Daily check-in", phase }];
  if (phase === "twice_weekly") return dow === 1 || dow === 4 ? [{ key: `${d}-day`, date: d, label: "Check-in", phase }] : [];
  return dow === 1 ? [{ key: `${d}-1on1`, date: d, label: "One-on-one", phase }] : [];
}

/** Every check-in from the first day through today, oldest first. */
export function checkInsThrough(startDate: string, today: string): CheckInSlot[] {
  const out: CheckInSlot[] = [];
  for (let d = startDate.slice(0, 10); d <= today.slice(0, 10); d = addDays(d, 1)) out.push(...checkInsOn(startDate, d));
  return out;
}

// ---------------------------------------------------------------------------
// Reviews (19)
// ---------------------------------------------------------------------------

export const REVIEW_DAYS = [30, 60, 90] as const;
export type ReviewDay = (typeof REVIEW_DAYS)[number];

/** The date of each review: day 30 is 29 days after the first day. */
export function reviewDates(startDate: string): Record<ReviewDay, string> {
  return { 30: addDays(startDate, 29), 60: addDays(startDate, 59), 90: addDays(startDate, 89) };
}

// ---------------------------------------------------------------------------
// Training (15 to 18)
// ---------------------------------------------------------------------------

/** Documented is the checklist itself; the other three are signed off by whoever trained them. */
export const TRAINING_PHASES = ["demonstrated", "duplicated", "released"] as const;
export type TrainingPhase = (typeof TRAINING_PHASES)[number];

export const TRAINING_LABEL: Record<TrainingPhase, string> = {
  demonstrated: "Shown",
  duplicated: "Done while watched",
  released: "Released",
};

export function trainingKey(task: string, phase: TrainingPhase): string {
  return `${task}:${phase}`;
}

/** The next phase to sign off for one task, or null when they're released on it. Phases go in order. */
export function nextTrainingPhase(done: ReadonlySet<string>, task: string): TrainingPhase | null {
  for (const phase of TRAINING_PHASES) if (!done.has(trainingKey(task, phase))) return phase;
  return null;
}

export function releasedOn(done: ReadonlySet<string>, tasks: readonly string[]): number {
  return tasks.filter((t) => done.has(trainingKey(t, "released"))).length;
}

// ---------------------------------------------------------------------------
// Fully operating (21) and levels
// ---------------------------------------------------------------------------

export interface JourneyState {
  startDate: string;
  today: string;
  tasks: readonly string[];
  /** Training sign-offs as keys, task:phase. */
  training: ReadonlySet<string>;
  reviewsDone: ReadonlySet<ReviewDay>;
  /** How many demonstrate or duplicate sign-offs this person has given someone else. */
  taughtOthers: number;
  /** Marked by the owner when this person writes and keeps up the task checklists. */
  ownsChecklists: boolean;
}

export interface FullyOperating {
  reached: boolean;
  /** What is still missing, in plain words. Empty once reached. */
  missing: string[];
}

/** Reached when check-ins are down to regular one-on-ones, every task is released, and the 30 and 60 day reviews are done. */
export function fullyOperating(s: JourneyState): FullyOperating {
  const missing: string[] = [];
  if (phaseOn(s.startDate, s.today) !== "one_on_one") missing.push("Check-ins aren't down to weekly one-on-ones yet");
  const released = releasedOn(s.training, s.tasks);
  if (released < s.tasks.length) missing.push(`Released on ${released} of ${s.tasks.length} tasks`);
  for (const day of [30, 60] as const) if (!s.reviewsDone.has(day)) missing.push(`Day ${day} review not done`);
  return { reached: missing.length === 0, missing };
}

export type Level = "none" | "individual_contributor" | "manager" | "leader";

export const LEVEL_LABEL: Record<Level, string> = {
  none: "Learning",
  individual_contributor: "Level 1: Individual contributor",
  manager: "Level 2: Manager",
  leader: "Level 3: Leader",
};

/**
 * Alex's three levels, each built on the one below. Level 1 once they're
 * released on every task (they know what to do). Level 2 once they have
 * trained someone else (they know how, well enough to teach). Level 3 once
 * they own the checklists, so the system does the teaching.
 */
export function levelOf(s: Pick<JourneyState, "tasks" | "training" | "taughtOthers" | "ownsChecklists">): Level {
  if (s.tasks.length === 0 || releasedOn(s.training, s.tasks) < s.tasks.length) return "none";
  if (s.taughtOthers === 0) return "individual_contributor";
  if (!s.ownsChecklists) return "manager";
  return "leader";
}

export function journeyDay(startDate: string, today: string): number {
  return dayNumber(startDate, today);
}
