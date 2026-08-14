"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EvaluationList } from "@/components/evaluations/evaluation-list";
import { EvaluationCalendar } from "@/components/evaluations/evaluation-calendar";
import type { JobWithLocation } from "@/lib/data/jobs";
import type { DayOff, WeeklyAvailability } from "@/types/domain";

export function EvaluationsView({
  overdue,
  upcoming,
  past,
  allRelevantJobs,
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
  currentProfileId: string;
  evaluatorNamesById?: Record<string, string>;
  allWeeklyAvailability: WeeklyAvailability[];
  allDaysOff: DayOff[];
  rangeStart: string;
  rangeEnd: string;
}) {
  return (
    <Tabs defaultValue="list">
      <TabsList>
        <TabsTrigger value="list">List</TabsTrigger>
        <TabsTrigger value="calendar">Calendar</TabsTrigger>
      </TabsList>
      <TabsContent value="list">
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
