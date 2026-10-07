import Link from "next/link";

import { needsScheduling, sortForView, type BoardJob, type JobView } from "@/lib/job-board";
import { ScheduleJobButton } from "@/components/jobs/schedule-job-button";

function when(value: string | null): string {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not scheduled";
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/**
 * One view of the board.
 *
 * A row is the whole job at a glance: who, where, when, and who has it. The
 * row is the link, so a thumb finds it on a phone without hunting for the job
 * number.
 */
export function JobBoardList({
  jobs,
  view,
  waiting,
  empty,
  canSchedule = false,
}: {
  jobs: BoardJob[];
  view: JobView;
  /** Why a job is not ready, by job id. Shown on the row where it is known. */
  waiting?: Map<string, string>;
  /** What to say when there is nothing, where the view has its own words. */
  empty?: string;
  /** Show a Schedule button on signed jobs with no work day. */
  canSchedule?: boolean;
}) {
  const rows = sortForView(jobs, view);

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        {empty ??
          (view === "upcoming"
          ? "No sold work waiting. Accepted proposals land here."
          : view === "active"
            ? "Nothing being worked on right now."
            : "No finished jobs yet.")}
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60">
      {rows.map((job) => (
        <li key={job.id} className="hover:bg-accent">
          <Link
            href={`/jobs/${job.id}`}
            className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2.5"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">
                {job.customerName ?? "No client"}
                {job.jobNumber != null && (
                  <span className="ml-2 font-mono text-xs text-muted-foreground">#{job.jobNumber}</span>
                )}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {job.address ?? "No address"} · {job.name}
              </span>
              {waiting?.get(job.id) && (
                <span className="mt-0.5 block truncate text-xs text-amber-700 dark:text-amber-400">
                  {waiting.get(job.id)}
                </span>
              )}
            </span>
            <span className="shrink-0 text-right text-xs text-muted-foreground">
              <span className="block">
                {view === "completed" ? when(job.completedAt) : needsScheduling(job) ? "Not scheduled" : when(job.startsOn)}
              </span>
              {job.assignedToName && <span className="block">{job.assignedToName}</span>}
            </span>
          </Link>
          {/* Outside the link, so booking it doesn't open the job. */}
          {canSchedule && needsScheduling(job) && (
            <div className="px-3 pb-2.5">
              <ScheduleJobButton jobId={job.id} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
