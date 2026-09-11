import { EvaluationsView } from "@/components/evaluations/evaluations-view";
import { JobBriefings } from "@/components/evaluations/job-briefings";
import { BookEvaluationPanel } from "@/components/evaluations/book-evaluation-panel";
import { listWorkSessionsByJob } from "@/lib/data/work-sessions";
import { getJobBriefings } from "@/lib/data/job-briefing";
import { CalendarSettings, type BookingLinksData } from "@/components/calendars/calendar-settings";
import { MyBookingLink } from "@/components/booking/booking-links-panel";
import type { MyScheduleData } from "@/lib/data/my-schedule";
import type { CalendarWithMembers } from "@/types/domain";

/**
 * A part of the Calendar page, or all of it.
 *
 * Shared by /evaluations, the Schedule module and the homepage (for team
 * members without New Property access) so they are always exactly the same
 * page, not things that can drift apart.
 *
 * Schedule shows the grid and the booking links as separate tabs, which they
 * separate into cleanly -- they are two components sitting side by side here.
 * Availability deliberately does not separate: the weekly hours and the days
 * off are drawn on the calendar grid itself, inside EvaluationsView, which is
 * where somebody looks at them. Pulling them out would mean rewriting the
 * grid to satisfy a tab, and would leave a person checking who is free on a
 * different screen from the one showing what they are booked on.
 */
export async function MyEvaluationsContent({
  schedule,
  calendars,
  teamMembers,
  bookingLinks,
  myBookingLink,
  section = "all",
}: {
  schedule: MyScheduleData;
  /** Admin-only calendar management, shown inline under the schedule. */
  calendars?: CalendarWithMembers[];
  teamMembers?: { id: string; name: string }[];
  bookingLinks?: BookingLinksData;
  /** The viewer's own affiliate link, if they have one. */
  myBookingLink?: string | null;
  /** Which half to draw. "all" is the whole page, as it was. */
  section?: "all" | "calendar" | "booking";
}) {
  const {
    profile,
    isAdmin,
    relevantJobs,
    scheduledJobs,
    evaluatorNamesById,
    allWeeklyAvailability,
    allDaysOff,
    rangeStart,
    rangeEnd,
  } = schedule;

  // Gathered here so both the Calendar page and the homepage version get it
  // without either having to know how a briefing is assembled.
  const briefings = await getJobBriefings(scheduledJobs).catch(() => []);

  // Visits drive the work layer, so a paused job draws two blocks instead of
  // one continuous run nobody is working.
  const workSessions = await listWorkSessionsByJob();

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
      {section === "booking" ? (
        <>
          <h1 className="mb-1 text-2xl font-bold">Booking</h1>
          <p className="mb-6 text-muted-foreground">
            The links clients use to book themselves in, and the calendars those bookings land on.
          </p>
        </>
      ) : (
        <>
          <h1 className="mb-1 text-2xl font-bold">{isAdmin ? "Team Calendar" : "My Calendar"}</h1>
          <p className="mb-6 text-muted-foreground">
            {isAdmin
              ? "Every evaluation across the team — who, where, when, and status."
              : "Evaluations assigned to you — where to go, when, and your progress on each one."}
          </p>
        </>
      )}
      {/* Above the calendar rather than on the booking tab: the booking tab is
          about the links clients use, and this is the office typing one in
          while somebody is still on the phone. Folded shut, because the
          calendar is what they came here to look at. */}
      {section !== "booking" && (
        <BookEvaluationPanel
          evaluators={Object.entries(evaluatorNamesById ?? {}).map(([id, name]) => ({ id, name }))}
        />
      )}
      {section !== "booking" && <JobBriefings briefings={briefings} />}
      {section !== "booking" && <EvaluationsView
        overdue={overdue}
        upcoming={upcoming}
        past={past}
        allRelevantJobs={relevantJobs}
        scheduledJobs={scheduledJobs}
        workSessions={workSessions}
        currentProfileId={profile.id}
        evaluatorNamesById={evaluatorNamesById}
        allWeeklyAvailability={allWeeklyAvailability}
        allDaysOff={allDaysOff}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
      />}
      {section !== "calendar" && myBookingLink && <MyBookingLink link={myBookingLink} />}
      {section !== "calendar" && isAdmin && calendars && teamMembers && (
        <CalendarSettings calendars={calendars} teamMembers={teamMembers} bookingLinks={bookingLinks} />
      )}
    </div>
  );
}
