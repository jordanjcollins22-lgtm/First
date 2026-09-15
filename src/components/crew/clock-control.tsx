"use client";

import { useEffect, useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { clockIn, clockOut, type ClockResult } from "@/lib/actions/time-clock-actions";
import { describeHours, hoursOn, type TimeEntry } from "@/lib/time-clock";

/**
 * The entry this screen shows while the real one is being written.
 *
 * The identity fields are blank on purpose. Nothing here reads them — the
 * panel shows the job, the time it started and how long that has been — and
 * who the row belongs to is the server's answer to give, on the row payroll
 * will actually be run from. This one lives on one phone for about a second.
 */
function startingNow(jobId: string | null, jobName: string | null, sessionId: string | null): TimeEntry {
  return {
    id: "pending",
    profileId: "",
    personName: "",
    jobId,
    jobName,
    sessionId,
    clockedInAt: new Date().toISOString(),
    clockedOutAt: null,
    note: null,
    editedByName: null,
  };
}

/**
 * On the clock, or not.
 *
 * The one control the admin timesheet depends on: without somewhere to press
 * start, every hours figure in the business is somebody's recollection.
 *
 * Picking the job is one tap from today's stops rather than a search — the
 * person pressing it is standing on the property, and the list of places they
 * could be is already on the screen above.
 *
 * The panel flips on the tap rather than on the reply. Somebody standing in a
 * driveway on one bar of signal pressed start, saw nothing happen, and pressed
 * it again — which is two entries, and two entries for one morning is an
 * argument at payroll. The clock they see is their own until the server's
 * answer lands on top of it; if the server refuses, the panel goes back to
 * what it was and says why.
 */
export function ClockControl({
  open,
  stops,
}: {
  open: TimeEntry | null;
  stops: { jobId: string; sessionId: string; name: string }[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);
  // React holds this until the transition ends, which is when the refreshed
  // page arrives — so the local answer hands back to the server's the moment
  // there is one, and a refusal rolls it back with nothing left to undo.
  const [running, setRunning] = useOptimistic<TimeEntry | null>(open);

  const since = running?.clockedInAt ?? null;

  // A running total that does not run is a stopped clock with extra steps.
  useEffect(() => {
    if (!since) return;
    const timer = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, [since]);

  function run(next: TimeEntry | null, work: () => Promise<ClockResult>) {
    setError(null);
    startTransition(async () => {
      setRunning(next);
      const result = await work();
      if (result.ok) {
        router.refresh();
        return;
      }
      // The clock is back where it was by the time this shows: saying "on the
      // clock" over an entry that was never written is the one failure this
      // control cannot have.
      setError(result.message);
    });
  }

  if (running) {
    return (
      <div className="mb-4 rounded-xl border border-emerald-600/40 bg-emerald-50/60 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-emerald-800">
              On the clock · {describeHours(hoursOn(running))}
            </p>
            <p className="truncate text-xs text-emerald-800/80">
              {running.jobName ?? "No job"} · since{" "}
              {new Date(running.clockedInAt).toLocaleTimeString(undefined, {
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={() => run(null, () => clockOut())}>
            <Square className="mr-1 h-4 w-4" />
            Clock out
          </Button>
        </div>
        {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-xl border border-white/60 bg-card/60 p-3 backdrop-blur-md">
      <p className="mb-2 text-sm font-medium">Clock in</p>
      <div className="flex flex-wrap gap-1.5">
        {stops.map((stop) => (
          <Button
            key={stop.jobId}
            type="button"
            size="sm"
            variant="outline"
            // The stop is the visit, so the hours land on it and the
            // visit can say who worked it.
            onClick={() =>
              run(startingNow(stop.jobId, stop.name, stop.sessionId), () =>
                clockIn(stop.jobId, undefined, stop.sessionId)
              )
            }
          >
            <Play className="mr-1 h-3.5 w-3.5" />
            {stop.name}
          </Button>
        ))}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          // Loading up, the shop, the yard — real hours that belong to no job.
          onClick={() => run(startingNow(null, null, null), () => clockIn(null))}
        >
          Yard / shop
        </Button>
      </div>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}
