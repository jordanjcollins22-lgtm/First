"use client";

import { useState, useTransition } from "react";
import { CalendarClock, CalendarX, Loader2, RotateCcw, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HolidayNotice, HolidayRangeNotice } from "@/components/job/holiday-notice";
import {
  cancelEstimate,
  cancelJob,
  reopenJob,
  scheduleEstimate,
  setJobWorkDates,
} from "@/lib/actions/job-actions";
import {
  canCancelEstimate,
  canCancelJob,
  canReopenJob,
  canRescheduleEstimate,
  EVALUATION_STATUS_LABELS,
  JOB_STATUS_LABELS,
  type JobShape,
} from "@/lib/job-lifecycle";
import { evaluationMinutes } from "@/lib/scheduling";
import type { EvaluationStatus, JobStatus } from "@/types/domain";

/** A stored UTC instant as the local "YYYY-MM-DDTHH:mm" a datetime-local wants. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const offset = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 16);
}

/** Back the other way. The browser gives local wall-clock time; new Date()
 * reads it as local, which is exactly the intent. */
function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** A stored date as a short readable day. */
function formatDay(value: string): string {
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatLength(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

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
  evaluationEndDate,
  projectStartDate,
  projectEndDate,
  sessionCount,
  cancellationReason,
}: {
  jobId: string;
  status: JobStatus;
  evaluationStatus: EvaluationStatus;
  evaluationDate: string | null;
  evaluationEndDate: string | null;
  projectStartDate: string | null;
  projectEndDate: string | null;
  /** How many live visits this job has. Above zero, the visits own the dates
   * and this panel steps back rather than offering a competing editor. */
  sessionCount: number;
  cancellationReason: string | null;
}) {
  // datetime-local wants "YYYY-MM-DDTHH:mm" in local time, which is what the
  // person booking is actually thinking in.
  const [estimateStart, setEstimateStart] = useState(toLocalInput(evaluationDate));
  const [estimateEnd, setEstimateEnd] = useState(toLocalInput(evaluationEndDate));
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
    evaluationEndDate,
    projectStartDate,
    projectEndDate,
  };

  // Shows the length while it is being chosen, including the assumed default
  // when no end has been set — so nobody has to guess what blank means.
  const plannedMinutes = evaluationMinutes(
    fromLocalInput(estimateStart),
    fromLocalInput(estimateEnd)
  );

  const estimateMove = canRescheduleEstimate(job);
  const estimateKill = canCancelEstimate(job);
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
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs font-medium">
              Starts
              <Input
                type="datetime-local"
                value={estimateStart}
                disabled={!estimateMove.ok || isPending}
                onChange={(e) => setEstimateStart(e.target.value)}
              />
              <HolidayNotice value={estimateStart} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium">
              Ends
              <Input
                type="datetime-local"
                value={estimateEnd}
                disabled={!estimateMove.ok || isPending}
                onChange={(e) => setEstimateEnd(e.target.value)}
              />
            </label>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="min-h-11 sm:min-h-9"
              disabled={!estimateMove.ok || isPending}
              onClick={() =>
                run(() =>
                  scheduleEstimate(
                    jobId,
                    fromLocalInput(estimateStart),
                    fromLocalInput(estimateEnd)
                  )
                )
              }
            >
              {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {evaluationDate ? "Move" : "Schedule"}
            </Button>

            {plannedMinutes != null && (
              <span className="text-[11px] text-muted-foreground">
                {formatLength(plannedMinutes)}
                {!estimateEnd && " (assumed)"}
              </span>
            )}
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

          {/* When the job has visits, they own these columns by trigger and an
              editor here would be a second place to write the same fact. With
              no visits there is nothing else that can fix them, and read-only
              wrong dates with no way out is the worse failure. */}
          {sessionCount > 0 ? (
            <>
              {projectStartDate ? (
                <p className="text-sm">
                  {formatDay(projectStartDate)}
                  {projectEndDate && projectEndDate !== projectStartDate && ` – ${formatDay(projectEndDate)}`}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">Not on the calendar yet.</p>
              )}
              <p className="mt-1 text-[11px] text-muted-foreground">
                Set by the {sessionCount === 1 ? "visit" : "visits"} booked below — book, move or cancel
                a visit in Visits &amp; tickets and these follow.
              </p>
            </>
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs font-medium">
                  Start
                  <Input
                    type="date"
                    value={start}
                    disabled={isPending}
                    onChange={(e) => setStart(e.target.value)}
                  />
                  <HolidayNotice value={start} />
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium">
                  End
                  <Input
                    type="date"
                    value={end}
                    disabled={isPending}
                    onChange={(e) => setEnd(e.target.value)}
                  />
                  <HolidayNotice value={end} />
                </label>
              </div>
              {/* The days that ruin a week-long job are the ones in the
                  middle: somebody picks a Monday and a Friday and never
                  looks at the Thursday. */}
              <HolidayRangeNotice start={start} end={end} />

              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="min-h-11 sm:min-h-9"
                  disabled={isPending}
                  onClick={() => run(() => setJobWorkDates(jobId, start || null, end || null))}
                >
                  {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Save dates
                </Button>

                {(projectStartDate || projectEndDate) && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="min-h-11 sm:min-h-9"
                    disabled={isPending}
                    onClick={() => {
                      setStart("");
                      setEnd("");
                      run(() => setJobWorkDates(jobId, null, null));
                    }}
                  >
                    Clear
                  </Button>
                )}
              </div>

              <p className="mt-1 text-[11px] text-muted-foreground">
                Once you book a visit below, these follow the visits instead.
              </p>
            </>
          )}
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
