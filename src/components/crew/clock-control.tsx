"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { clockIn, clockOut } from "@/lib/actions/time-clock-actions";
import { describeHours, hoursOn, type TimeEntry } from "@/lib/time-clock";

/**
 * On the clock, or not.
 *
 * The one control the admin timesheet depends on: without somewhere to press
 * start, every hours figure in the business is somebody's recollection.
 *
 * Picking the job is one tap from today's stops rather than a search — the
 * person pressing it is standing on the property, and the list of places they
 * could be is already on the screen above.
 */
export function ClockControl({
  open,
  stops,
}: {
  open: TimeEntry | null;
  stops: { jobId: string; sessionId: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [, tick] = useState(0);

  // A running total that does not run is a stopped clock with extra steps.
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, [open]);

  function run(work: () => Promise<{ ok: boolean; message?: string }>) {
    setMessage(null);
    startTransition(async () => {
      const result = await work();
      setFailed(!result.ok);
      setMessage(result.message ?? null);
      if (result.ok) router.refresh();
    });
  }

  if (open) {
    return (
      <div className="mb-4 rounded-xl border border-emerald-600/40 bg-emerald-50/60 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-emerald-800">
              On the clock · {describeHours(hoursOn(open))}
            </p>
            <p className="truncate text-xs text-emerald-800/80">
              {open.jobName ?? "No job"} · since{" "}
              {new Date(open.clockedInAt).toLocaleTimeString(undefined, {
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => run(() => clockOut())}
          >
            {pending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Square className="mr-1 h-4 w-4" />
            )}
            Clock out
          </Button>
        </div>
        {message && (
          <p className={`mt-1 text-xs ${failed ? "text-red-700" : "text-emerald-800"}`}>{message}</p>
        )}
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
            disabled={pending}
            // The stop is the visit, so the hours land on it and the
            // visit can say who worked it.
            onClick={() => run(() => clockIn(stop.jobId, undefined, stop.sessionId))}
          >
            <Play className="mr-1 h-3.5 w-3.5" />
            {stop.name}
          </Button>
        ))}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          // Loading up, the shop, the yard — real hours that belong to no job.
          onClick={() => run(() => clockIn(null))}
        >
          Yard / shop
        </Button>
      </div>
      {message && (
        <p className={`mt-1 text-xs ${failed ? "text-red-700" : "text-emerald-700"}`}>{message}</p>
      )}
    </div>
  );
}
