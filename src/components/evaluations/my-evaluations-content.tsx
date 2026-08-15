import { EvaluationsView } from "@/components/evaluations/evaluations-view";
import { CalendarSettings } from "@/components/calendars/calendar-settings";
import type { MyScheduleData } from "@/lib/data/my-schedule";
import type { CalendarWithMembers } from "@/types/domain";

/** The full Calendar page content — shared by /evaluations and the
 * homepage (for team members without New Property access) so they're always
 * exactly the same page, not two things that can drift apart. */
export function MyEvaluationsContent({
  schedule,
  calendars,
  teamMembers,
}: {
  schedule: MyScheduleData;
  /** Admin-only calendar management, shown inline under the schedule. */
  calendars?: CalendarWithMembers[];
  teamMembers?: { id: string; name: string }[];
}) {
  const { profile, isAdmin, relevantJobs, evaluatorNamesById, allWeeklyAvailability, allDaysOff, rangeStart, rangeEnd } =
    schedule;

  const now = new Date().toISOString();
  const notCompleted = relevantJobs.filter((j) => j.evaluation_status !== "completed");

  const overdue = notCompleted
    .filter((j) => j.evaluation_date! < now)
    .sort((a, b) => a.evaluation_date!.localeCompare(b.evaluation_date!));

  const upcoming = notCompleted
    .filter((j) => j.evaluation_date! >= now)
    .sort((a, b) => a.evaluation_date!.localeCompare(b.evaluation_date!));

  const past = relevantJobs
    .filter((j) => j.evaluation_status === "completed")
    .sort((a, b) => b.evaluation_date!.localeCompare(a.evaluation_date!));

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold">{isAdmin ? "Team Calendar" : "My Calendar"}</h1>
      <p className="mb-6 text-muted-foreground">
        {isAdmin
          ? "Every evaluation across the team — who, where, when, and status."
          : "Evaluations assigned to you — where to go, when, and your progress on each one."}
      </p>
      <EvaluationsView
        overdue={overdue}
        upcoming={upcoming}
        past={past}
        allRelevantJobs={relevantJobs}
        currentProfileId={profile.id}
        evaluatorNamesById={evaluatorNamesById}
        allWeeklyAvailability={allWeeklyAvailability}
        allDaysOff={allDaysOff}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
      />
      {isAdmin && calendars && teamMembers && (
        <CalendarSettings calendars={calendars} teamMembers={teamMembers} />
      )}
    </div>
  );
}
