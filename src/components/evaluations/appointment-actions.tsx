"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardList, FolderOpen, Loader2, Navigation, Play } from "lucide-react";

import { evaluatorVisitStep } from "@/lib/actions/evaluator-home-actions";
import type { CalendarEvent } from "@/lib/calendar-events";

/** Who is looking at the calendar, which decides what an appointment offers. */
export type CalendarMode = "office" | "evaluator" | "crew";

/**
 * The buttons under a tapped appointment. Tapping the appointment itself only
 * zooms the map in on it; these are what open something.
 *
 * - The office opens the client's file.
 * - An evaluator starts (or carries on with) their own visit, gets directions,
 *   and opens the visit once it is submitted.
 * - The crew gets directions and the job sheet.
 */
export function AppointmentActions({ event, mode, currentProfileId }: { event: CalendarEvent; mode: CalendarMode; currentProfileId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${event.lat},${event.lng}`;

  if (mode === "office") {
    return (
      <div className="flex flex-wrap gap-2">
        <Link href={`/jobs/${event.jobId}`} className={secondary}>
          <FolderOpen className="h-4 w-4" /> Open file
        </Link>
      </div>
    );
  }

  if (mode === "crew") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <a href={directions} target="_blank" rel="noreferrer" className={secondary}>
          <Navigation className="h-4 w-4" /> Directions
        </a>
        <Link href={`/jobs/${event.jobId}/work-order?back=${encodeURIComponent("/v2/operations")}`} className={primary}>
          <ClipboardList className="h-4 w-4" /> Job sheet
        </Link>
      </div>
    );
  }

  // An evaluator, on a visit.
  const mine = event.assignedTo === currentProfileId;
  const status = event.evaluationStatus;
  const done = status === "completed";
  const canStart = event.layer === "evaluations" && mine && !done;

  function startVisit() {
    setError(null);
    start(async () => {
      // Already there: nothing to record, straight back in.
      if (status !== "arrived") {
        const result = await evaluatorVisitStep(event.jobId, "arrived");
        if (!result.ok) return setError(result.message);
      }
      router.push(`/evaluate/${event.jobId}?start=1`);
    });
  }

  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-2 gap-2">
        {canStart ? (
          <button type="button" disabled={pending} onClick={startVisit} className={primary}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {status === "arrived" ? "Continue evaluation" : "Start evaluation"}
          </button>
        ) : (
          <Link href={`/evaluate/${event.jobId}`} className={primary}>
            <FolderOpen className="h-4 w-4" /> Open file
          </Link>
        )}
        <a href={directions} target="_blank" rel="noreferrer" className={secondary}>
          <Navigation className="h-4 w-4" /> Directions
        </a>
      </div>
      {canStart && (
        <Link href={`/evaluate/${event.jobId}`} className="text-center text-xs font-medium text-muted-foreground underline underline-offset-2">
          Open the file instead
        </Link>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

const primary =
  "flex min-h-12 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-60";
const secondary = "flex min-h-12 items-center justify-center gap-1.5 rounded-xl border bg-card px-3 text-sm font-semibold hover:bg-muted";
