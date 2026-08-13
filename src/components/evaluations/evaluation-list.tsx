"use client";

import { useTransition } from "react";
import Link from "next/link";
import { Navigation } from "lucide-react";

import { Button } from "@/components/ui/button";
import { updateEvaluationStatus } from "@/lib/actions/job-actions";
import type { JobWithLocation } from "@/lib/data/jobs";
import type { EvaluationStatus } from "@/types/domain";

const STATUS_LABELS: Record<EvaluationStatus, string> = {
  scheduled: "Scheduled",
  on_way: "On the way",
  arrived: "Arrived",
  completed: "Completed",
};

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function directionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
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

function UpcomingCard({ job }: { job: JobWithLocation }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-white/60 bg-card/70 p-4 shadow-lg shadow-black/5 backdrop-blur-xl backdrop-saturate-150">
      <div>
        <p className="font-semibold">{job.property.address}</p>
        <p className="text-sm text-muted-foreground">{job.property.customer.name}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span>{formatWhen(job.evaluation_date!)}</span>
        <span aria-hidden>·</span>
        <span>{STATUS_LABELS[job.evaluation_status]}</span>
        <a
          href={directionsUrl(job.property.lat, job.property.lng)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-primary underline-offset-2 hover:underline"
        >
          <Navigation className="h-3.5 w-3.5" />
          Directions
        </a>
      </div>
      <div className="flex justify-end">
        <ActionButton jobId={job.id} status={job.evaluation_status} />
      </div>
    </div>
  );
}

function PastCard({ job }: { job: JobWithLocation }) {
  return (
    <Link
      href={`/jobs/${job.id}`}
      className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm hover:bg-accent/50"
    >
      <div className="min-w-0">
        <p className="truncate font-medium">{job.property.address}</p>
        <p className="truncate text-xs text-muted-foreground">{job.property.customer.name}</p>
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">
        {job.evaluation_date ? formatWhen(job.evaluation_date) : ""}
      </span>
    </Link>
  );
}

export function EvaluationList({ upcoming, past }: { upcoming: JobWithLocation[]; past: JobWithLocation[] }) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Upcoming</h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">No evaluations scheduled for you right now.</p>
        ) : (
          upcoming.map((job) => <UpcomingCard key={job.id} job={job} />)
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground">Past</h2>
        {past.length === 0 ? (
          <p className="text-sm text-muted-foreground">No submitted evaluations yet.</p>
        ) : (
          past.map((job) => <PastCard key={job.id} job={job} />)
        )}
      </div>
    </div>
  );
}
