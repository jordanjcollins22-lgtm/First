"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, MapPin, Navigation, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { markVisit, undoVisit } from "@/lib/actions/evaluation-visit-actions";
import type { VisitStage } from "@/lib/evaluation-visit";

/**
 * The one button a visit needs next: On my way, then I've arrived. On my
 * way opens the directions; I've arrived opens the visit. After arriving it
 * says when, with an undo for a mis-tap.
 */
export function VisitAction({
  jobId,
  stage,
  arrivedAt,
  timeZone,
  openVisitAfterArrive = true,
  preview = false,
}: {
  jobId: string;
  stage: VisitStage;
  arrivedAt?: string | null;
  timeZone: string;
  openVisitAfterArrive?: boolean;
  /** For the owner's walk-through: the buttons show, and record nothing. */
  preview?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function press(step: "on_way" | "arrived") {
    setError(null);
    if (preview) return setError(step === "on_way" ? "Preview: this records the time and opens directions." : "Preview: this records the time and opens the visit.");
    start(async () => {
      const result = await markVisit(jobId, step);
      if (!result.ok) return setError(result.message);
      if (step === "on_way") router.push(`/jobs/${jobId}/directions`);
      else if (openVisitAfterArrive) router.push(`/evaluate/${jobId}`);
      else router.refresh();
    });
  }

  function undo() {
    setError(null);
    if (preview) return;
    start(async () => {
      const result = await undoVisit(jobId);
      if (!result.ok) return setError(result.message);
      router.refresh();
    });
  }

  if (stage === "submitted") {
    return (
      <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-700">
        <CheckCircle2 className="h-4 w-4" /> Walkthrough complete · with the account manager
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {stage === "booked" && (
        <Button type="button" className="h-12 w-full text-base font-semibold" disabled={pending} onClick={() => press("on_way")}>
          {pending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Navigation className="mr-2 h-5 w-5" />}
          On my way · Directions
        </Button>
      )}
      {stage === "on_way" && (
        <div className="flex gap-2">
          <Button type="button" className="h-12 flex-1 text-base font-semibold" disabled={pending} onClick={() => press("arrived")}>
            {pending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <MapPin className="mr-2 h-5 w-5" />}
            I&apos;ve arrived
          </Button>
          <Button type="button" variant="outline" className="h-12" disabled={pending} onClick={undo} aria-label="Undo On my way">
            <Undo2 className="h-4 w-4" />
          </Button>
        </div>
      )}
      {stage === "arrived" && (
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-emerald-700">
          <CheckCircle2 className="h-4 w-4" />
          Arrived
          {arrivedAt && ` at ${new Date(arrivedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone })}`}
          <button type="button" className="text-xs font-normal text-muted-foreground underline" disabled={pending} onClick={undo}>
            Undo
          </button>
        </p>
      )}
      {error && <p className={preview ? "text-xs text-muted-foreground" : "text-sm text-destructive"}>{error}</p>}
    </div>
  );
}
