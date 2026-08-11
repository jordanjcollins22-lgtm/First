"use client";

import { colorForJobStatus } from "./attractor-colors";
import type { JobWithLocation } from "@/lib/data/jobs";

const STATUS_LABEL: Record<string, string> = {
  estimating: "Estimating",
  quoted: "Quoted",
  approved: "Approved",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function ProjectList({
  jobs,
  selectedJobId,
  onSelect,
}: {
  jobs: JobWithLocation[];
  selectedJobId: string | null;
  onSelect: (id: string) => void;
}) {
  if (jobs.length === 0) {
    return <p className="p-3 text-xs text-muted-foreground">No projects match the current filters.</p>;
  }

  return (
    <ul className="flex flex-col gap-1 p-2">
      {jobs.map((job) => (
        <li key={job.id}>
          <button
            type="button"
            onClick={() => onSelect(job.id)}
            className={`flex w-full items-start gap-2 rounded-md p-1.5 text-left text-sm ${
              job.id === selectedJobId ? "bg-accent" : "hover:bg-accent/50"
            }`}
          >
            <span
              className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: colorForJobStatus(job.status) }}
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{job.property.customer.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{job.property.address}</span>
            </span>
            <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {STATUS_LABEL[job.status] ?? job.status}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
