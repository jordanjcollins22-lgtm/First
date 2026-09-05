"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EvaluationList } from "@/components/evaluations/evaluation-list";
import { EvaluationCalendar } from "@/components/evaluations/evaluation-calendar";
import { JobSchedulePanel } from "@/components/evaluations/job-schedule-panel";
import type { JobWithLocation } from "@/lib/data/jobs";
import type { DayOff, WeeklyAvailability } from "@/types/domain";

export function EvaluationsView({
  overdue,
  upcoming,
  past,
  allRelevantJobs,
  scheduledJobs,
  workSessions,
  currentProfileId,
  evaluatorNamesById,
  allWeeklyAvailability,
  allDaysOff,
  rangeStart,
  rangeEnd,
}: {
  overdue: JobWithLocation[];
  upcoming: JobWithLocation[];
  past: JobWithLocation[];
  allRelevantJobs: JobWithLocation[];
  scheduledJobs: JobWithLocation[];
  /** Visits per job, so the work layer can show pauses as gaps. */
  workSessions: Map<string, { starts_on: string; ends_on: string; status: string }[]>;
  currentProfileId: string;
  evaluatorNamesById?: Record<string, string>;
  allWeeklyAvailability: WeeklyAvailability[];
  allDaysOff: DayOff[];
  rangeStart: string;
  rangeEnd: string;
}) {
  return (
    <Tabs defaultValue="calendar">
      <TabsList>
        <TabsTrigger value="calendar">Calendar</TabsTrigger>
        <TabsTrigger value="list">List</TabsTrigger>
      </TabsList>
      <TabsContent value="list">
        <JobSchedulePanel jobs={scheduledJobs} />
        <EvaluationList
          overdue={overdue}
          upcoming={upcoming}
          past={past}
          currentProfileId={currentProfileId}
          evaluatorNamesById={evaluatorNamesById}
        />
      </TabsContent>
      <TabsContent value="calendar">
        <EvaluationCalendar
          jobs={allRelevantJobs}
          scheduledJobs={scheduledJobs}
          workSessions={workSessions}
          currentProfileId={currentProfileId}
          evaluatorNamesById={evaluatorNamesById}
          allWeeklyAvailability={allWeeklyAvailability}
          allDaysOff={allDaysOff}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
        />
      </TabsContent>
    </Tabs>
  );
}
