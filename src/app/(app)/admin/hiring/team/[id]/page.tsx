import { notFound } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { getCurrentProfile } from "@/lib/data/team";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { getJourney, reviewsDone, trainingDone } from "@/lib/data/journey";
import { roleDocFor } from "@/lib/hiring/role-docs";
import { positionFor } from "@/lib/hiring/positions";
import { checkInsOn, checkInsThrough, fullyOperating, journeyDay, levelOf, phaseOn, reviewDates, REVIEW_DAYS } from "@/lib/hiring/journey";
import { NewHireJourney } from "@/components/hiring/new-hire-journey";

/** One new hire's way from day one to fully operating. */
export const dynamic = "force-dynamic";

export default async function NewHirePage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("hiring", "/admin");
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const { id } = await params;
  const j = await getJourney(profile.organization_id, id);
  if (!j) notFound();
  const doc = roleDocFor(j.position);
  if (!doc) notFound();

  const training = trainingDone(j.steps);
  const reviews = reviewsDone(j.steps);
  const logged = new Set(j.steps.filter((s) => s.kind === "checkin").map((s) => s.key));
  // Today's, plus any in the last 14 days that nobody logged.
  const twoWeeksAgo = new Date(Date.parse(`${j.today}T12:00:00Z`) - 14 * 86_400_000).toISOString().slice(0, 10);
  const today = checkInsOn(j.startDate, j.today).map((c) => ({ ...c, missed: false }));
  const missed = checkInsThrough(j.startDate, j.today)
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
  };

  return (
    <NewHireJourney
      id={j.id}
      name={j.name}
      positionTitle={positionFor(j.position ?? "")?.title ?? "New hire"}
      day={journeyDay(j.startDate, j.today)}
      doc={doc}
      buddyName={j.buddyName}
      ownsChecklists={j.ownsChecklists}
      phase={phaseOn(j.startDate, j.today)}
      checkIns={[...today, ...missed.reverse()]}
      reviewDates={REVIEW_DAYS.map((day) => ({ day, date: dates[day], due: dates[day] <= j.today }))}
      steps={j.steps}
      fully={fullyOperating(state)}
      level={levelOf(state)}
    />
  );
}
