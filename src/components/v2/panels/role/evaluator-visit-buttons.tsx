"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Navigation, Phone, Play } from "lucide-react";

import { evaluatorVisitStep } from "@/lib/actions/evaluator-home-actions";
import { EVALUATOR_HOME } from "@/lib/evaluator-home";
import type { VisitStage } from "@/lib/evaluation-visit";

/**
 * A visit's buttons on the evaluator's home screen: Start visit, big, and
 * beside it the way there and the client's phone.
 *
 * Start visit records the arrival and opens the visit straight at the
 * walkthrough. Directions opens the in-app map, which comes back here.
 */
export function EvaluatorVisitButtons({
  jobId,
  stage,
  phone,
  firstName,
  tour = false,
}: {
  jobId: string;
  stage: VisitStage;
  phone: string | null;
  firstName: string;
  /** The first visit of the day carries the tutorial's markers. */
  tour?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"start" | "way" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function go(step: "on_way" | "arrived") {
    setError(null);
    setBusy(step === "arrived" ? "start" : "way");
    start(async () => {
      // Already there: nothing to record, straight back in.
      const needs = step === "arrived" ? stage !== "arrived" : stage === "booked";
      if (needs) {
        const result = await evaluatorVisitStep(jobId, step);
        if (!result.ok) {
          setBusy(null);
          return setError(result.message);
        }
      }
      router.push(step === "arrived" ? `/evaluate/${jobId}?start=1` : `/jobs/${jobId}/directions?back=${encodeURIComponent(EVALUATOR_HOME)}`);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => go("arrived")}
        data-tour={tour ? "eval-start" : undefined}
        className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary text-lg font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
      >
        {busy === "start" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />}
        {stage === "arrived" ? "Continue visit" : "Start visit"}
      </button>
      <div className="grid grid-cols-2 gap-2" data-tour={tour ? "eval-directions" : undefined}>
        <button
          type="button"
          disabled={pending}
          onClick={() => go("on_way")}
          className="flex min-h-12 items-center justify-center gap-1.5 rounded-xl border bg-card px-2 text-sm font-semibold hover:bg-muted disabled:opacity-60"
        >
          {busy === "way" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Navigation className="h-4 w-4" />}
          {stage === "booked" ? "On my way" : "Directions"}
        </button>
        {phone ? (
          <a href={`tel:${phone}`} className="flex min-h-12 items-center justify-center gap-1.5 rounded-xl border bg-card px-2 text-sm font-semibold hover:bg-muted">
            <Phone className="h-4 w-4" /> Call {firstName}
          </a>
        ) : (
          <span className="flex min-h-12 items-center justify-center rounded-xl border border-dashed px-2 text-center text-xs text-muted-foreground">No phone on file</span>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
