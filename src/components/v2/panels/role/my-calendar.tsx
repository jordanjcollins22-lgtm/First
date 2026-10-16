import { getMyScheduleData } from "@/lib/data/my-schedule";
import { listWorkSessionsByJob } from "@/lib/data/work-sessions";
import { myOpenEntry } from "@/lib/data/time-clock";
import { getCrewDay } from "@/lib/data/crew-day";
import { EvaluationCalendar } from "@/components/evaluations/evaluation-calendar";
import { ClockControl } from "@/components/crew/clock-control";

/**
 * An evaluator's or crew member's home screen: their calendar and nothing
 * else. The day comes first with its map, the month under it. Tapping an
 * appointment zooms the map in on it; its buttons open the file, start the
 * evaluation, or the job sheet, whichever fits the person and the visit.
 *
 * The crew keep the clock above it, since their hours are paid from it.
 * Drawn as the person shown, so Preview as shows exactly this.
 */
export async function MyCalendarPanel({ mode }: { mode: "evaluator" | "crew" }) {
  const schedule = await getMyScheduleData();
  if (!schedule) return <p className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">Sign in to see your calendar.</p>;
  const [workSessions, clock] = await Promise.all([
    listWorkSessionsByJob(),
    mode === "crew" ? Promise.all([myOpenEntry(schedule.profile.id).catch(() => null), getCrewDay().catch(() => null)]) : Promise.resolve(null),
  ]);

  return (
    <div className="mx-auto grid w-full max-w-2xl gap-4">
      {clock && (
        <div data-tour="crew-clock">
          <ClockControl
            open={clock[0]}
            stops={(clock[1]?.stops ?? []).map((stop) => ({ jobId: stop.jobId, sessionId: stop.sessionId, name: stop.customerName }))}
          />
        </div>
      )}
      <div data-tour="my-calendar">
        <EvaluationCalendar
          mode={mode}
          jobs={mode === "evaluator" ? schedule.relevantJobs : []}
          scheduledJobs={schedule.scheduledJobs}
          workSessions={workSessions}
          currentProfileId={schedule.profile.id}
          evaluatorNamesById={schedule.evaluatorNamesById}
          allWeeklyAvailability={schedule.allWeeklyAvailability}
          allDaysOff={schedule.allDaysOff}
          rangeStart={schedule.rangeStart}
          rangeEnd={schedule.rangeEnd}
        />
      </div>
    </div>
  );
}
