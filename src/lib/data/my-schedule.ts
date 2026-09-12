import { getCurrentProfile, listProfiles } from "@/lib/data/team";
import { listJobsWithLocation, type JobWithLocation } from "@/lib/data/jobs";
import { listDaysOff, listWeeklyAvailability } from "@/lib/data/availability";
import type { DayOff, Profile, WeeklyAvailability } from "@/types/domain";

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface MyScheduleData {
  profile: Profile;
  isAdmin: boolean;
  relevantJobs: JobWithLocation[];
  /** Jobs with work days set — what the crew's Jobs calendar shows. Kept
   * separate from relevantJobs, which is evaluations only. */
  scheduledJobs: JobWithLocation[];
  evaluatorNamesById?: Record<string, string>;
  allWeeklyAvailability: WeeklyAvailability[];
  allDaysOff: DayOff[];
  rangeStart: string;
  rangeEnd: string;
}

/** Everything the calendar (on /evaluations and the homepage) needs — shared so
 * both stay in sync instead of drifting apart with their own copies. */
export async function getMyScheduleData(): Promise<MyScheduleData | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const isAdmin = profile.roles.includes("admin");

  const jobs = await listJobsWithLocation();
  // Admins see every evaluation across the team; everyone else sees only
  // what's assigned to them.
  const relevantJobs = (isAdmin ? jobs : jobs.filter((j) => j.assigned_to === profile.id)).filter(
    (j) => j.evaluation_date
  );

  // Same visibility rule as evaluations: admins see the whole crew's work,
  // everyone else sees what's theirs.
  const scheduledJobs = (isAdmin ? jobs : jobs.filter((j) => j.assigned_to === profile.id)).filter(
    (j) => j.project_start_date || j.project_end_date
  );

  let evaluatorNamesById: Record<string, string> | undefined;
  if (isAdmin) {
    const profiles = await listProfiles();
    evaluatorNamesById = Object.fromEntries(profiles.map((p) => [p.id, p.full_name || p.email]));
  }

  const today = new Date();
  const rangeStartDate = new Date(today.getFullYear(), today.getMonth() - 2, 1);
  const rangeEndDate = new Date(today.getFullYear(), today.getMonth() + 6, 0);
  const rangeStart = dateKey(rangeStartDate);
  const rangeEnd = dateKey(rangeEndDate);

  const [allWeeklyAvailability, allDaysOff] = await Promise.all([
    listWeeklyAvailability(),
    listDaysOff(rangeStart, rangeEnd),
  ]);

  return {
    profile,
    isAdmin,
    relevantJobs,
    scheduledJobs,
    evaluatorNamesById,
    allWeeklyAvailability,
    allDaysOff,
    rangeStart,
    rangeEnd,
  };
}
