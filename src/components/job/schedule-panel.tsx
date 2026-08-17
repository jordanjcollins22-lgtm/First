"use client";

import { useState, useTransition } from "react";
import { CalendarClock, CalendarX, Loader2, RotateCcw, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  cancelEstimate,
  cancelJob,
  reopenJob,
  rescheduleJob,
  scheduleEstimate,
} from "@/lib/actions/job-actions";
import {
  canCancelEstimate,
  canCancelJob,
  canReopenJob,
  canRescheduleEstimate,
  canRescheduleJob,
  EVALUATION_STATUS_LABELS,
  JOB_STATUS_LABELS,
  type JobShape,
} from "@/lib/job-lifecycle";
import type { EvaluationStatus, JobStatus } from "@/types/domain";

/**
 * Booking, moving and calling off the work.
 *
 * Every button asks the same rule module the server action will ask, so a
 * button that would be refused is disabled with the reason showing rather than
 * failing after the tap. That matters most on a phone, where the round trip is
 * slow and the person is usually standing in front of the customer.
 */
export function SchedulePanel({
  jobId,
  status,
  evaluationStatus,
  evaluationDate,
  projectStartDate,
  projectEndDate,
  cancellationReason,
}: {
  jobId: string;
  status: JobStatus;
  evaluationStatus: EvaluationStatus;
  evaluationDate: string | null;
  projectStartDate: string | null;
  projectEndDate: string | null;
  cancellationReason: string | null;
}) {
  const [estimateOn, setEstimateOn] = useState(evaluationDate?.slice(0, 10) ?? "");
  const [start, setStart] = useState(projectStartDate?.slice(0, 10) ?? "");
  const [end, setEnd] = useState(projectEndDate?.slice(0, 10) ?? "");
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState<"estimate" | "job" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const job: JobShape = {
    status,
    evaluationStatus,
    evaluationDate,
    projectStartDate,
    projectEndDate,
  };

  const estimateMove = canRescheduleEstimate(job);
  const estimateKill = canCancelEstimate(job);
  const jobMove = canRescheduleJob(job);
  const jobKill = canCancelJob(job);
  const jobBack = canReopenJob(job);

  function run(work: () => Promise<{ ok: boolean; message?: string }>) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await work();
      if (result.ok) {
        setMessage(result.message ?? "Done.");
        setConfirming(null);
        setReason("");
      } else {
        setError(result.message ?? "That didn't work.");
      }
    });
  }

  return (
    <section className="rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <CalendarClock className="h-4 w-4" />
          Scheduling
        </h2>
        <Badge tone={status === "cancelled" ? "bad" : status === "completed" ? "good" : "neutral"}>
          {JOB_STATUS_LABELS[status]}
        </Badge>
        {evaluationDate && (
          <Badge tone={evaluationStatus === "cancelled" ? "bad" : "neutral"}>
            Estimate: {EVALUATION_STATUS_LABELS[evaluationStatus]}
          </Badge>
        )}
      </div>

      {status === "cancelled" && (
        <div className="mb-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs">
          <p className="font-semibold text-destructive">This job is cancelled.</p>
          {cancellationReason && <p className="mt-0.5 text-muted-foreground">{cancellationReason}</p>}
          <p className="mt-1 text-muted-foreground">
            Nothing was deleted — the proposal, messages and estimate history are all still here.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {/* -------------------------------------------------- estimate visit */}
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Estimate visit
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="flex flex-1 flex-col gap-1 text-xs font-medium">
              Date
              <Input
                type="date"
                value={estimateOn}
                disabled={!estimateMove.ok || isPending}
                onChange={(e) => setEstimateOn(e.target.value)}
              />
            </label>
            <Button
              type="button"
              size="sm"
              className="min-h-11 sm:min-h-9"
              disabled={!estimateMove.ok || isPending}
              onClick={() => run(() => scheduleEstimate(jobId, estimateOn || null))}
            >
              {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {evaluationDate ? "Move" : "Schedule"}
            </Button>
          </div>

          {!estimateMove.ok && <Note>{estimateMove.reason}</Note>}

          {estimateKill.ok &&
            (confirming === "estimate" ? (
              <Confirm
                label="Cancel this estimate visit?"
                reason={reason}
                onReason={setReason}
                onCancel={() => setConfirming(null)}
                onConfirm={() => run(() => cancelEstimate(jobId, reason))}
                pending={isPending}
              />
            ) : (
              <button
                type="button"
                onClick={() => setConfirming("estimate")}
                className="mt-2 flex min-h-9 items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
              >
                <CalendarX className="h-3.5 w-3.5" />
                Cancel this estimate
              </button>
            ))}
        </div>

        {/* ------------------------------------------------------ work dates */}
        <div className="border-t border-border pt-3">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Work dates
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs font-medium">
              Start
              <Input
                type="date"
                value={start}
                disabled={!jobMove.ok || isPending}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium">
              End
              <Input
                type="date"
                value={end}
                disabled={!jobMove.ok || isPending}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              className="min-h-11 sm:min-h-9"
              disabled={!jobMove.ok || isPending}
              onClick={() => run(() => rescheduleJob(jobId, start || null, end || null))}
            >
              {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {projectStartDate ? "Reschedule" : "Schedule work"}
            </Button>

            {projectStartDate && jobMove.ok && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="min-h-11 sm:min-h-9"
                disabled={isPending}
                onClick={() => {
                  setStart("");
                  setEnd("");
                  run(() => rescheduleJob(jobId, null, null));
                }}
              >
                Take off calendar
              </Button>
            )}
          </div>

          {!jobMove.ok && <Note>{jobMove.reason}</Note>}
        </div>

        {/* ---------------------------------------------------------- the job */}
        <div className="border-t border-border pt-3">
          {jobBack.ok ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="min-h-11 sm:min-h-9"
              disabled={isPending}
              onClick={() => run(() => reopenJob(jobId))}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Reopen this job
            </Button>
          ) : jobKill.ok ? (
            confirming === "job" ? (
              <Confirm
                label="Cancel this whole job?"
                reason={reason}
                onReason={setReason}
                onCancel={() => setConfirming(null)}
                onConfirm={() => run(() => cancelJob(jobId, reason))}
                pending={isPending}
              />
            ) : (
              <button
                type="button"
                onClick={() => setConfirming("job")}
                className="flex min-h-9 items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
              >
                <XCircle className="h-3.5 w-3.5" />
                Cancel this job
              </button>
            )
          ) : (
            <Note>{jobKill.ok ? "" : jobKill.reason}</Note>
          )}
        </div>
      </div>

      {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
      {message && <p className="mt-3 text-xs text-emerald-700">{message}</p>}
    </section>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "good" | "bad" | "neutral" }) {
  const styles =
    tone === "bad"
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : tone === "good"
        ? "border-emerald-600/40 bg-emerald-50 text-emerald-800"
        : "border-border bg-secondary/60 text-muted-foreground";
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${styles}`}>{children}</span>;
}

function Note({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return <p className="mt-1.5 text-[11px] text-muted-foreground">{children}</p>;
}

/** Cancelling is destructive and easy to fat-finger on a phone, so it takes a
 * second deliberate tap — and asks why, which is the part people want later. */
function Confirm({
  label,
  reason,
  onReason,
  onCancel,
  onConfirm,
  pending,
}: {
  label: string;
  reason: string;
  onReason: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <div className="mt-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
      <p className="mb-2 text-xs font-semibold">{label}</p>
      <Input
        value={reason}
        onChange={(e) => onReason(e.target.value)}
        placeholder="Why? (optional, but useful later)"
        className="mb-2"
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="destructive"
          className="min-h-11 sm:min-h-9"
          disabled={pending}
          onClick={onConfirm}
        >
          {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Yes, cancel
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="min-h-11 sm:min-h-9"
          disabled={pending}
          onClick={onCancel}
        >
          Keep it
        </Button>
      </div>
    </div>
  );
}
