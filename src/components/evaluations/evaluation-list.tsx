"use client";

import { useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, Navigation } from "lucide-react";

import { Button } from "@/components/ui/button";
import { updateEvaluationStatus } from "@/lib/actions/job-actions";
import { EVALUATION_STATUS_LABELS } from "@/lib/job-lifecycle";
import type { JobWithLocation } from "@/lib/data/jobs";
import type { EvaluationStatus } from "@/types/domain";

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** The app's own directions screen. It used to jump out to a Google Maps
 * search, which loses whoever tapped it to another app mid-day. */
function directionsUrl(jobId: string): string {
  return `/jobs/${jobId}/directions`;
}

function ActionButton({ jobId, status }: { jobId: string; status: EvaluationStatus }) {
  const [isPending, startTransition] = useTransition();

  if (status === "scheduled") {
    return (
      <Button
        type="button"
        disabled={isPending}
        onClick={() => startTransition(() => updateEvaluationStatus(jobId, "on_way"))}
      >
        On My Way
      </Button>
    );
  }
  if (status === "on_way") {
    return (
      <Button
        type="button"
        disabled={isPending}
        onClick={() => startTransition(() => updateEvaluationStatus(jobId, "arrived"))}
      >
        Arrived
      </Button>
    );
  }
  if (status === "arrived") {
    return (
      <Button type="button" asChild>
        <Link href={`/jobs/${jobId}`}>Start Evaluation</Link>
      </Button>
    );
  }
  return null;
}

function evaluatorName(job: JobWithLocation, evaluatorNamesById?: Record<string, string>): string | null {
  if (!evaluatorNamesById || !job.assigned_to) return null;
  return evaluatorNamesById[job.assigned_to] ?? null;
}

function UpcomingCard({
  job,
  currentProfileId,
  evaluatorNamesById,
  overdue = false,
}: {
  job: JobWithLocation;
  currentProfileId: string | null;
  evaluatorNamesById?: Record<string, string>;
  overdue?: boolean;
}) {
  const isMine = job.assigned_to === currentProfileId;
  const name = evaluatorName(job, evaluatorNamesById);

  return (
    <div
      className={
        overdue
          ? "flex flex-col gap-3 rounded-2xl border border-destructive/40 bg-destructive/5 p-4 shadow-lg shadow-black/5 backdrop-blur-xl backdrop-saturate-150"
          : "flex flex-col gap-3 rounded-2xl border border-white/60 bg-card/70 p-4 shadow-lg shadow-black/5 backdrop-blur-xl backdrop-saturate-150"
      }
    >
      <div>
        <p className="font-semibold">{job.property.address}</p>
        <p className="text-sm text-muted-foreground">{job.property.customer.name}</p>
      </div>
      {overdue && (
        <p className="flex items-center gap-1.5 text-sm font-medium text-destructive">
          <AlertTriangle className="h-4 w-4" />
          Evaluation date passed and it still hasn&apos;t been submitted
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span>{formatWhen(job.evaluation_date!)}</span>
        <span aria-hidden>·</span>
        <span>{EVALUATION_STATUS_LABELS[job.evaluation_status]}</span>
        {name && (
          <>
            <span aria-hidden>·</span>
            <span>{name}</span>
          </>
        )}
        <Link
          href={directionsUrl(job.id)}
          className="flex items-center gap-1 text-primary underline-offset-2 hover:underline"
        >
          <Navigation className="h-3.5 w-3.5" />
          Directions
        </Link>
      </div>
      {isMine && (
        <div className="flex justify-end">
          <ActionButton jobId={job.id} status={job.evaluation_status} />
        </div>
      )}
    </div>
  );
}

function PastCard({
  job,
  evaluatorNamesById,
}: {
  job: JobWithLocation;
  evaluatorNamesById?: Record<string, string>;
}) {
  const name = evaluatorName(job, evaluatorNamesById);

  return (
    <Link
      href={`/jobs/${job.id}`}
      className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm hover:bg-accent/50"
    >
      <div className="min-w-0">
        <p className="truncate font-medium">{job.property.address}</p>
        <p className="truncate text-xs text-muted-foreground">
          {job.property.customer.name}
          {name && ` · ${name}`}
        </p>
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">
        {job.evaluation_date ? formatWhen(job.evaluation_date) : ""}
      </span>
    </Link>
  );
}

export function EvaluationList({
  overdue = [],
  upcoming,
  past,
  currentProfileId = null,
  evaluatorNamesById,
}: {
  overdue?: JobWithLocation[];
  upcoming: JobWithLocation[];
  past: JobWithLocation[];
  currentProfileId?: string | null;
  evaluatorNamesById?: Record<string, string>;
}) {
  return (
    <div className="flex flex-col gap-8">
      {overdue.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
            <AlertTriangle className="h-4 w-4" />
            Overdue
          </h2>
          {overdue.map((job) => (
            <UpcomingCard
              key={job.id}
              job={job}
              currentProfileId={currentProfileId}
              evaluatorNamesById={evaluatorNamesById}
              overdue
            />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Upcoming</h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">No evaluations scheduled right now.</p>
        ) : (
          upcoming.map((job) => (
            <UpcomingCard
              key={job.id}
              job={job}
              currentProfileId={currentProfileId}
              evaluatorNamesById={evaluatorNamesById}
            />
          ))
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground">Past</h2>
        {past.length === 0 ? (
          <p className="text-sm text-muted-foreground">No submitted evaluations yet.</p>
        ) : (
          past.map((job) => <PastCard key={job.id} job={job} evaluatorNamesById={evaluatorNamesById} />)
        )}
      </div>
    </div>
  );
}
