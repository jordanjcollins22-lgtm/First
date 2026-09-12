import { CalendarDays } from "lucide-react";

import type { JobWithLocation } from "@/lib/data/jobs";

/** A job is "on the crew's calendar" when it has project dates — the window
 * between starting and expecting to finish. Anything already completed or
 * cancelled drops off, since the crew isn't going back out for it. */
function isScheduled(job: JobWithLocation): boolean {
  if (job.status === "completed" || job.status === "cancelled") return false;
  return Boolean(job.project_start_date || job.project_end_date);
}

function formatDay(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * What the crew works off: jobs with work days set, soonest first.
 *
 * Separate from the evaluations calendar above it on purpose — an evaluation
 * is one appointment on one day, while a job runs across a window and often
 * needs a return trip.
 */
export function JobSchedulePanel({ jobs }: { jobs: JobWithLocation[] }) {
  const scheduled = jobs
    .filter(isScheduled)
    .sort((a, b) =>
      (a.project_end_date ?? a.project_start_date ?? "").localeCompare(
        b.project_end_date ?? b.project_start_date ?? ""
      )
    );

  if (scheduled.length === 0) return null;

  const today = new Date().toLocaleDateString("en-CA");

  return (
    <section className="mb-6 rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
        <CalendarDays className="h-4 w-4" />
        Jobs
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Work days the crew is booked for. Set from the job, or by asking the assistant.
      </p>

      <ul className="space-y-2">
        {scheduled.map((job) => {
          const start = job.project_start_date;
          const end = job.project_end_date;
          const due = end ?? start;
          const overdue = Boolean(due && due < today);

          return (
            <li
              key={job.id}
              className={`rounded-lg border px-3 py-2 ${
                overdue ? "border-amber-400/70 bg-amber-50/60" : "border-white/60 bg-background/50"
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className="text-sm font-medium">{job.property.customer.name}</p>
                <p className="text-xs tabular-nums text-muted-foreground">
                  {start && end && start !== end
                    ? `${formatDay(start)} – ${formatDay(end)}`
                    : formatDay(due!)}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">{job.property.address}</p>
              <p className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                {job.status.replace("_", " ")}
                {overdue && " · past due"}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
