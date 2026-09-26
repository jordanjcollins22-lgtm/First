/**
 * Sold work, sorted by where it is.
 *
 * The Jobs module asks one question the old app never answered on one screen:
 * of the work we have actually sold, what is coming, what is happening now,
 * and what is finished. Everything before "approved" is a sale, not a job, and
 * belongs to the Sales pipeline; a cancelled job is neither.
 *
 * Two of the views the brief asks for -- Ready and Needs attention -- are
 * deliberately not here. Ready is not a status somebody sets, it is the answer
 * to a set of pre-start checks, and Needs attention is the set of open blocking
 * issues. Neither exists yet, and a tab that silently shows the wrong jobs is
 * worse than a tab that is not there: somebody would drive to a job this
 * screen called Ready. They arrive with the readiness engine and the issue
 * system, and this file is where they will be computed.
 */

export type JobView = "upcoming" | "active" | "completed";

export const JOB_VIEWS: readonly JobView[] = ["upcoming", "active", "completed"];

export interface BoardJob {
  id: string;
  jobNumber: number | null;
  name: string;
  status: string;
  address: string | null;
  customerName: string | null;
  assignedToName: string | null;
  /** Who the job is assigned to, and who manages the client: whose it is. */
  assignedToId?: string | null;
  accountManagerId?: string | null;
  /** Start of the work, or the evaluation that is still standing in for it. */
  startsOn: string | null;
  /** Start of the work alone: null until a work day is booked. */
  workStartsOn?: string | null;
  completedAt: string | null;
  /** Somebody said this is not going ahead, whatever the status still says. */
  declined?: boolean;
}

/**
 * Which view a job belongs in, or null when it is not a job yet.
 *
 * Read off the status rather than stored, so a job cannot be in two views or
 * in none because somebody forgot to move it.
 */
export function viewOf(status: string, declined = false): JobView | null {
  // A declined job is not upcoming work, however it was declined and
  // whatever status it was left with. One sat in Upcoming for four days
  // after being marked declined on the board, because only the status was
  // read here.
  if (declined && status !== "completed") return null;
  switch (status) {
    case "approved":
      return "upcoming";
    case "in_progress":
      return "active";
    case "completed":
      return "completed";
    // estimating and quoted are a sale in progress, not work; cancelled is
    // neither, and putting it in Completed would flatter the numbers.
    default:
      return null;
  }
}

export function jobsInView(jobs: readonly BoardJob[], view: JobView): BoardJob[] {
  return jobs.filter((job) => viewOf(job.status, job.declined) === view);
}

/** How many are in each view, for the tab labels. */
export function viewCounts(jobs: readonly BoardJob[]): Record<JobView, number> {
  const counts: Record<JobView, number> = { upcoming: 0, active: 0, completed: 0 };
  for (const job of jobs) {
    const view = viewOf(job.status, job.declined);
    if (view) counts[view] += 1;
  }
  return counts;
}

/**
 * The order a view is read in.
 *
 * Upcoming and active are read forwards -- the soonest thing first, because
 * that is the next thing somebody has to do. Completed is read backwards, most
 * recently finished first, because nobody scrolls to the oldest finished job.
 */
export function sortForView(jobs: readonly BoardJob[], view: JobView): BoardJob[] {
  const at = (job: BoardJob) => (view === "completed" ? job.completedAt : job.startsOn);
  return [...jobs].sort((a, b) => {
    const x = at(a);
    const y = at(b);
    // A job with no date sits at the end of a forward list: it is the one
    // nobody has scheduled, which is a thing to notice, not to lead with.
    if (!x && !y) return (b.jobNumber ?? 0) - (a.jobNumber ?? 0);
    if (!x) return 1;
    if (!y) return -1;
    return view === "completed" ? y.localeCompare(x) : x.localeCompare(y);
  });
}

/**
 * Whether a job or an evaluation is this person's: assigned to them, or for a
 * client they manage. What an account manager or an evaluator is shown in
 * Operations, rather than the whole company's list.
 */
export function isTheirs(item: { assignedToId?: string | null; accountManagerId?: string | null }, profileId: string): boolean {
  return item.assignedToId === profileId || item.accountManagerId === profileId;
}

/**
 * Sold and waiting on a date: the proposal is signed and no work day is
 * booked. `startsOn` cannot answer this, because it stands in with the
 * evaluation date until the work has one of its own.
 */
export function needsScheduling(job: Pick<BoardJob, "status" | "declined" | "workStartsOn">): boolean {
  return job.status === "approved" && !job.declined && !job.workStartsOn;
}
