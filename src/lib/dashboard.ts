/**
 * The whole business on one screen.
 *
 * Every other page answers one question — this job, this client, my day. The
 * question nobody could answer without opening six tabs was the simplest one:
 * what is happening right now, and what is about to go wrong.
 *
 * So this buckets every job twice, once as the visit that gets it priced and
 * once as the work itself, and puts both under the same date window. Bucketing
 * is derived from the statuses already on the row, like the pipeline and the
 * job stage before it — a stored "dashboard state" would be a fourth thing to
 * keep in sync and would start lying the first time somebody cancelled a job
 * from a different screen.
 *
 * Nothing here writes. The dashboard is a mirror; the doing happens on the
 * pages it links to.
 */

import type { EvaluationStatus, JobStatus } from "@/types/domain";

export type DashboardRange = "today" | "week" | "month";

export const RANGES: { key: DashboardRange; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
];

/** A local calendar day, not a UTC instant. An 8pm evaluation belongs to the
 * evening it happens on, which is not the day UTC would file it under. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The day a stored timestamp or date falls on. Plain dates ("2026-08-19")
 * are already day keys and are left alone — parsing them as instants is what
 * shifts a work date back a day for anybody west of Greenwich. */
export function dayKeyOf(value: string | null): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : dayKey(parsed);
}

export interface DateWindow {
  start: string;
  end: string;
  /** What the window is, in words, for the header. */
  label: string;
}

/** Monday, because that is when the work week starts for everybody who has to
 * read this screen. */
function startOfWeek(today: Date): Date {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const shift = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - shift);
  return d;
}

export function windowFor(range: DashboardRange, today: Date = new Date()): DateWindow {
  if (range === "today") {
    const key = dayKey(today);
    return { start: key, end: key, label: "Today" };
  }
  if (range === "week") {
    const start = startOfWeek(today);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    return { start: dayKey(start), end: dayKey(end), label: "Mon–Sun this week" };
  }
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return { start: dayKey(start), end: dayKey(end), label: "This calendar month" };
}

function inWindow(key: string | null, w: DateWindow): boolean {
  return key !== null && key >= w.start && key <= w.end;
}

/** Whether a job's work window touches the dashboard's window at all. A job
 * running Monday to Friday belongs on Wednesday's screen even though neither
 * of its own dates is Wednesday. */
function overlaps(start: string | null, end: string | null, w: DateWindow): boolean {
  const from = start ?? end;
  const to = end ?? start;
  if (!from || !to) return false;
  return from <= w.end && to >= w.start;
}

export type EvaluationBucket = "arrived" | "on_way" | "scheduled" | "completed" | "cancelled";

/** `history` piles start collapsed. What already happened is worth being able
 * to check and not worth scrolling past to reach what has not. */
export const EVALUATION_BUCKETS: { key: EvaluationBucket; label: string; blurb: string; history?: boolean }[] = [
  { key: "arrived", label: "Happening now", blurb: "On site, evaluating." },
  { key: "on_way", label: "On the way", blurb: "Driving to it." },
  { key: "scheduled", label: "Scheduled", blurb: "Booked, nobody has set off yet." },
  { key: "completed", label: "Evaluated", blurb: "Visit done — these are ready to price.", history: true },
  { key: "cancelled", label: "Cancelled", blurb: "Called off.", history: true },
];

export type JobBucket =
  | "working"
  | "needs_signoff"
  | "scheduled"
  | "unscheduled"
  | "quoting"
  | "completed"
  | "cancelled";

export const JOB_BUCKETS: { key: JobBucket; label: string; blurb: string; history?: boolean }[] = [
  { key: "working", label: "On site now", blurb: "Crew is working it." },
  { key: "needs_signoff", label: "Needs sign-off", blurb: "The work window has passed and nobody closed it." },
  { key: "scheduled", label: "Booked in", blurb: "Sold, with days on the calendar." },
  { key: "unscheduled", label: "Sold, not booked", blurb: "Accepted with no days set. These are the ones that rot." },
  { key: "quoting", label: "Out for a decision", blurb: "Priced and sent — waiting on the client." },
  { key: "completed", label: "Finished", blurb: "Signed off.", history: true },
  { key: "cancelled", label: "Cancelled", blurb: "Called off.", history: true },
];

/**
 * Whether a job belongs on one person's own board.
 *
 * Two ways in, and both are needed. The account manager on the client owns
 * everything that happens to that client. But an account manager who went out
 * and evaluated somebody else's client is still expected at that appointment,
 * and a day that left it off would be lying by omission.
 */
export function isTheirs(
  job: { accountManagerId: string | null; assignedTo: string | null },
  profileId: string
): boolean {
  return job.accountManagerId === profileId || job.assignedTo === profileId;
}

export interface DashboardJobInput {
  id: string;
  jobName: string;
  customerName: string;
  address: string;
  status: JobStatus;
  evaluationStatus: EvaluationStatus;
  /** Timestamp of the evaluation appointment. */
  evaluationDate: string | null;
  projectStartDate: string | null;
  projectEndDate: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  proposalStatus: string | null;
  /** Proposal total, for the booked-value line. */
  value: number | null;
  /** Who is on it — the evaluator for a visit, the crew lead for the work. */
  personName: string | null;
}

export interface DashboardRow {
  jobId: string;
  customerName: string;
  address: string;
  jobName: string;
  /** The date driving this row's bucket, as a day key. */
  date: string | null;
  personName: string | null;
  value: number | null;
  /** Due before the window started and still not done. */
  overdue: boolean;
}

export interface DashboardSection<K extends string> {
  key: K;
  label: string;
  blurb: string;
  /** Already happened — rendered collapsed. */
  history?: boolean;
  rows: DashboardRow[];
}

export interface DashboardSummary {
  /** Visits still to happen in the window — the day's obligations. */
  evaluationsDue: number;
  /** Anything scheduled before the window and still not done. */
  overdue: number;
  jobsOnSite: number;
  needsSignoff: number;
  /** Sold work in the window, at proposal value. */
  bookedValue: number;
}

export interface DashboardData {
  range: DashboardRange;
  window: DateWindow;
  evaluations: DashboardSection<EvaluationBucket>[];
  jobs: DashboardSection<JobBucket>[];
  summary: DashboardSummary;
}

/**
 * Which evaluation pile a job sits in, or null if it has no visit at all.
 *
 * Cancelling the job cancels the visit with it — a job called off after being
 * evaluated shows as cancelled here rather than sitting in "Evaluated" as
 * though somebody still has to price it.
 */
export function evaluationBucket(job: DashboardJobInput): EvaluationBucket | null {
  if (!job.evaluationDate) return null;
  if (job.status === "cancelled" || job.evaluationStatus === "cancelled") return "cancelled";
  if (job.evaluationStatus === "arrived") return "arrived";
  if (job.evaluationStatus === "on_way") return "on_way";
  if (job.evaluationStatus === "completed") return "completed";
  return "scheduled";
}

/**
 * Which work pile a job sits in.
 *
 * Order matters: what is happening beats what was planned, and a job whose
 * window has passed without a sign-off is called out rather than left looking
 * scheduled. Jobs still being evaluated have no work state yet, so they are
 * left out entirely — they are on the evaluation half of the screen.
 */
export function jobBucket(job: DashboardJobInput, today: string): JobBucket | null {
  if (job.status === "cancelled") return "cancelled";
  if (job.status === "completed") return "completed";

  const sold = job.status === "approved" || job.status === "in_progress" || job.proposalStatus === "accepted";
  const endKey = dayKeyOf(job.projectEndDate ?? job.projectStartDate);
  const booked = Boolean(job.projectStartDate || job.projectEndDate);

  if (job.status === "in_progress") {
    return endKey !== null && endKey < today ? "needs_signoff" : "working";
  }
  if (sold) {
    if (!booked) return "unscheduled";
    return endKey !== null && endKey < today ? "needs_signoff" : "scheduled";
  }
  if (job.proposalStatus === "sent" || job.proposalStatus === "needs_approval") return "quoting";
  return null;
}

function rowFor(job: DashboardJobInput, date: string | null, overdue: boolean): DashboardRow {
  return {
    jobId: job.id,
    customerName: job.customerName,
    address: job.address,
    jobName: job.jobName,
    date,
    personName: job.personName,
    value: job.value,
    overdue,
  };
}

/** Newest work first within a pile, and rows with no date last — an undated
 * row is a backlog item, not today's problem. */
function byDate(a: DashboardRow, b: DashboardRow): number {
  if (a.date === b.date) return a.customerName.localeCompare(b.customerName);
  if (!a.date) return 1;
  if (!b.date) return -1;
  return a.date < b.date ? -1 : 1;
}

/**
 * Everything on the screen, for one window.
 *
 * Two rules make the piles honest. Anything still outstanding from before the
 * window is pulled in and flagged overdue rather than dropped, because a visit
 * nobody made last Tuesday does not stop mattering on Wednesday. And the piles
 * with no date of their own — sold-but-unbooked, out for a decision — always
 * show, because filtering them by a date they do not have would hide exactly
 * the work that goes quiet.
 */
export function buildDashboard(
  jobs: DashboardJobInput[],
  range: DashboardRange,
  today: Date = new Date()
): DashboardData {
  const w = windowFor(range, today);
  const todayKey = dayKey(today);

  const evaluations = new Map<EvaluationBucket, DashboardRow[]>(
    EVALUATION_BUCKETS.map((b) => [b.key, []])
  );
  const work = new Map<JobBucket, DashboardRow[]>(JOB_BUCKETS.map((b) => [b.key, []]));

  for (const job of jobs) {
    const evalKey = dayKeyOf(job.evaluationDate);
    const bucket = evaluationBucket(job);
    if (bucket) {
      const outstanding = bucket === "arrived" || bucket === "on_way" || bucket === "scheduled";
      const overdue = outstanding && evalKey !== null && evalKey < w.start;
      // Done and cancelled visits are history: they belong to their own day and
      // nowhere else. Outstanding ones carry forward until somebody deals
      // with them.
      if (inWindow(evalKey, w) || overdue) {
        evaluations.get(bucket)!.push(rowFor(job, evalKey, overdue));
      }
    }

    const jobKey = jobBucket(job, todayKey);
    if (!jobKey) continue;

    const startKey = dayKeyOf(job.projectStartDate);
    const endKey = dayKeyOf(job.projectEndDate);

    if (jobKey === "completed") {
      const key = dayKeyOf(job.completedAt) ?? endKey;
      if (inWindow(key, w)) work.get(jobKey)!.push(rowFor(job, key, false));
      continue;
    }
    if (jobKey === "cancelled") {
      const key = dayKeyOf(job.cancelledAt) ?? endKey ?? evalKey;
      if (inWindow(key, w)) work.get(jobKey)!.push(rowFor(job, key, false));
      continue;
    }
    if (jobKey === "unscheduled" || jobKey === "quoting") {
      work.get(jobKey)!.push(rowFor(job, null, false));
      continue;
    }
    if (jobKey === "needs_signoff") {
      // Always shown, whichever window is picked. Work that finished three
      // weeks ago and was never closed is more urgent, not less.
      work.get(jobKey)!.push(rowFor(job, endKey ?? startKey, true));
      continue;
    }
    if (overlaps(startKey, endKey, w)) {
      work.get(jobKey)!.push(rowFor(job, startKey ?? endKey, false));
    }
  }

  const evaluationSections = EVALUATION_BUCKETS.map((b) => ({
    ...b,
    rows: evaluations.get(b.key)!.sort(byDate),
  }));
  const jobSections = JOB_BUCKETS.map((b) => ({ ...b, rows: work.get(b.key)!.sort(byDate) }));

  const rowsIn = (key: JobBucket) => jobSections.find((s) => s.key === key)!.rows;
  const evalRowsIn = (key: EvaluationBucket) => evaluationSections.find((s) => s.key === key)!.rows;

  const due = [...evalRowsIn("arrived"), ...evalRowsIn("on_way"), ...evalRowsIn("scheduled")];

  return {
    range,
    window: w,
    evaluations: evaluationSections,
    jobs: jobSections,
    summary: {
      evaluationsDue: due.length,
      overdue: due.filter((r) => r.overdue).length,
      jobsOnSite: rowsIn("working").length,
      needsSignoff: rowsIn("needs_signoff").length,
      bookedValue: [...rowsIn("working"), ...rowsIn("scheduled"), ...rowsIn("needs_signoff")].reduce(
        (sum, r) => sum + (r.value ?? 0),
        0
      ),
    },
  };
}
