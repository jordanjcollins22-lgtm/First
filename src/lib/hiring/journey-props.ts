import { reviewsDone, taperFrom, trainingDone, type JourneyView } from "@/lib/data/journey";
import { roleDocFor } from "@/lib/hiring/role-docs";
import { positionFor } from "@/lib/hiring/positions";
import { checkInsOn, checkInsThrough, fullyOperating, journeyDay, levelOf, nextTaper, phaseOn, reviewDates, REVIEW_DAYS } from "@/lib/hiring/journey";
import type { JourneyProps } from "@/components/hiring/new-hire-journey";

/**
 * What the new-hire page shows, worked out from one hire's journey. Shared by
 * the real page and the no-login preview, so the preview can't drift.
 */
export function journeyProps(j: JourneyView, buddyOptions: string[]): JourneyProps | null {
  const doc = roleDocFor(j.position);
  if (!doc) return null;
  const training = trainingDone(j.steps);
  const reviews = reviewsDone(j.steps);
  const taper = taperFrom(j.steps);
  const logged = new Set(j.steps.filter((s) => s.kind === "checkin").map((s) => s.key));
  // Today's, plus any in the last 14 days that nobody logged.
  const twoWeeksAgo = new Date(Date.parse(`${j.today}T12:00:00Z`) - 14 * 86_400_000).toISOString().slice(0, 10);
  const today = checkInsOn(j.startDate, j.today, taper).map((c) => ({ ...c, missed: false }));
  const missed = checkInsThrough(j.startDate, j.today, taper)
    .filter((c) => c.date < j.today && c.date >= twoWeeksAgo && !logged.has(c.key))
    .map((c) => ({ ...c, missed: true }));
  const dates = reviewDates(j.startDate);
  const state = {
    startDate: j.startDate,
    today: j.today,
    tasks: j.tasks,
    training,
    reviewsDone: reviews,
    taughtOthers: j.taughtOthers,
    ownsChecklists: j.ownsChecklists,
    taper,
  };
  return {
    id: j.id,
    name: j.name,
    positionTitle: positionFor(j.position ?? "")?.title ?? "New hire",
    day: journeyDay(j.startDate, j.today),
    doc,
    buddyName: j.buddyName,
    ownsChecklists: j.ownsChecklists,
    phase: phaseOn(j.startDate, j.today, taper),
    nextTaper: nextTaper(j.startDate, j.today, taper),
    buddyOptions,
    checkIns: [...today, ...missed.reverse()],
    reviewDates: REVIEW_DAYS.map((day) => ({ day, date: dates[day], due: dates[day] <= j.today })),
    steps: j.steps,
    fully: fullyOperating(state),
    level: levelOf(state),
  };
}
