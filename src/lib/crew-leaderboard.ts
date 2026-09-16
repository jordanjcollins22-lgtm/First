/**
 * Who gets the work done, and done right.
 *
 * A crew member is judged on the jobs they were on: how many finished, how
 * many finished on the day they were meant to, and how many came back to
 * bite. A ticket is a return trip; one caused by our workmanship or design
 * is a mistake; a quality or damage issue or a complaint is the client
 * telling us the same. Fewer of those beats more days worked, because a
 * job done twice was not done.
 */

export interface CrewJob {
  jobId: string;
  status: string;
  /** Whether this person led the crew on it. */
  lead: boolean;
  /** Work days this person had on it, and how many are done. */
  sessionsScheduled: number;
  sessionsDone: number;
  /** First and last scheduled day. */
  firstDay: string | null;
  lastDay: string | null;
  projectEndDate: string | null;
  completedAt: string | null;
  /** Return trips raised on the job, by cause. */
  tickets: { cause: string | null }[];
  /** Quality, damage and complaint issues raised on the job. */
  issues: { type: string }[];
}

export interface CrewInput {
  profileId: string;
  name: string;
  jobs: CrewJob[];
}

export interface CrewStanding {
  profileId: string;
  name: string;
  rank: number;
  jobs: number;
  led: number;
  daysWorked: number;
  daysScheduled: number;
  completed: number;
  onTime: number;
  late: number;
  onTimeRate: number | null;
  mistakes: number;
  callbacks: number;
  complaints: number;
}

const MISTAKE_CAUSES = new Set(["workmanship", "design"]);
const COMPLAINT_TYPES = new Set(["quality", "damage", "complaint"]);

function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

/** Finished on or before the day it was meant to end. No end date on file is on time by default. */
export function finishedOnTime(job: Pick<CrewJob, "completedAt" | "projectEndDate" | "lastDay">): boolean | null {
  if (!job.completedAt) return null;
  const due = job.projectEndDate ?? job.lastDay;
  if (!due) return true;
  return dayOf(completedLocal(job.completedAt)) <= due;
}

/** Completion timestamps are UTC; the day it happened is the business's day. */
function completedLocal(iso: string): string {
  const d = new Date(iso);
  const local = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return local;
}

function inWindow(job: CrewJob, since: Date | null): boolean {
  if (!since) return true;
  const day = job.lastDay ?? job.firstDay ?? job.completedAt;
  if (!day) return false;
  return new Date(day).getTime() >= since.getTime();
}

export function rankCrew(inputs: CrewInput[], options: { since?: Date | null } = {}): CrewStanding[] {
  const since = options.since ?? null;
  return inputs
    .map((person) => {
      const jobs = person.jobs.filter((j) => inWindow(j, since));
      const completedJobs = jobs.filter((j) => j.status === "completed");
      const judged = completedJobs.map(finishedOnTime).filter((v): v is boolean => v !== null);
      const onTime = judged.filter(Boolean).length;
      const late = judged.length - onTime;
      return {
        profileId: person.profileId,
        name: person.name,
        rank: 0,
        jobs: jobs.length,
        led: jobs.filter((j) => j.lead).length,
        daysWorked: jobs.reduce((sum, j) => sum + j.sessionsDone, 0),
        daysScheduled: jobs.reduce((sum, j) => sum + j.sessionsScheduled, 0),
        completed: completedJobs.length,
        onTime,
        late,
        onTimeRate: judged.length >= 2 ? onTime / judged.length : null,
        mistakes: jobs.reduce((sum, j) => sum + j.tickets.filter((t) => t.cause != null && MISTAKE_CAUSES.has(t.cause)).length, 0),
        callbacks: jobs.reduce((sum, j) => sum + j.tickets.length, 0),
        complaints: jobs.reduce((sum, j) => sum + j.issues.filter((i) => COMPLAINT_TYPES.has(i.type)).length, 0),
      };
    })
    .filter((s) => s.jobs > 0)
    .sort(
      (a, b) =>
        b.completed - a.completed ||
        a.mistakes - b.mistakes ||
        a.callbacks - b.callbacks ||
        b.onTime - a.onTime ||
        b.daysWorked - a.daysWorked ||
        a.name.localeCompare(b.name)
    )
    .map((s, i) => ({ ...s, rank: i + 1 }));
}
