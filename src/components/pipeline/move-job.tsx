"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Move } from "lucide-react";

import { clearPipelineOverride, moveJobOnPipeline } from "@/lib/actions/pipeline-move-actions";
import { movableTo, type PipelineStage } from "@/lib/pipeline";

/**
 * Moving a job on the board by hand.
 *
 * A picker rather than a drag: this is read on a phone in a driveway, and
 * dragging a card between three columns that scroll sideways is a gesture
 * that fails more often than it works.
 *
 * The move is not permanent in the way a stored status would be. It holds
 * until the paperwork catches up — the proposal gets accepted, the crew gets
 * scheduled — and then the board goes back to reading the job, which is what
 * keeps a hand placement from quietly outliving its reason.
 */
export function MoveJob({
  jobId,
  overridden,
}: {
  jobId: string;
  /** Already sitting somewhere somebody put it. */
  overridden: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function move(stage: PipelineStage, status: string) {
    setError(null);
    start(async () => {
      const result = await moveJobOnPipeline(jobId, stage, status);
      if (result.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(result.message);
      }
    });
  }

  function reset() {
    setError(null);
    start(async () => {
      const result = await clearPipelineOverride(jobId);
      if (result.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(result.message);
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 flex items-center gap-1 px-2 text-[11px] font-semibold text-muted-foreground"
      >
        <Move className="h-3 w-3" />
        Move
      </button>
    );
  }

  return (
    <div className="mt-1.5 flex flex-col gap-1 rounded-lg border border-border bg-background p-2">
      <p className="text-[11px] font-semibold text-muted-foreground">Move this to</p>
      {movableTo().map((place) => (
        <button
          key={place.label}
          type="button"
          disabled={pending}
          onClick={() => move(place.stage, place.status)}
          className="rounded px-1.5 py-1 text-left text-xs hover:bg-accent/50 disabled:opacity-50"
        >
          {place.label}
        </button>
      ))}

      {overridden && (
        <button
          type="button"
          disabled={pending}
          onClick={reset}
          className="mt-1 rounded px-1.5 py-1 text-left text-xs font-semibold text-primary disabled:opacity-50"
        >
          Put it back on automatic
        </button>
      )}

      <button
        type="button"
        onClick={() => setOpen(false)}
        className="mt-0.5 px-1.5 text-left text-xs text-muted-foreground"
      >
        Cancel
      </button>

      {error && <p className="px-1.5 text-xs text-destructive">{error}</p>}
    </div>
  );
}
