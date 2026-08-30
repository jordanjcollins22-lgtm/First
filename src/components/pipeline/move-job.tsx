"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Move } from "lucide-react";

import {
  clearPipelineOverride,
  moveJobOnPipeline,
  type MoveResponse,
} from "@/lib/actions/pipeline-move-actions";
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
 *
 * The card itself cannot move until the server says so: the board reads every
 * position off the job, on the server, and this control knows only its own
 * job's id. So it does not pretend to. What it can do — and now does — is
 * answer the tap: the picker closes and the control says where the job is
 * going, on the frame the finger lifts, and the card arrives in the new
 * column when the board re-renders behind it. Claiming the move had landed
 * would be a lie the next render might not back up.
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
  const [, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // What we have asked for, shown until the board comes back saying it. React
  // drops it when the transition ends, which is the moment the fresh board
  // arrives — so the echo never outlives the answer it was standing in for.
  const [asked, setAsked] = useOptimistic<string | null>(null);

  function send(echo: string, work: () => Promise<MoveResponse>) {
    setError(null);
    // Closed before anything is awaited. A picker that stays open under the
    // thumb invites a second tap on a second destination.
    setOpen(false);
    start(async () => {
      setAsked(echo);
      const result = await work();
      if (result.ok) {
        router.refresh();
        return;
      }
      // Nothing moved, so the picker comes back with the reason on it rather
      // than a card that quietly stayed where it was.
      setError(result.message);
      setOpen(true);
    });
  }

  function move(stage: PipelineStage, status: string, label: string) {
    send(`Moving to ${label}`, () => moveJobOnPipeline(jobId, stage, status));
  }

  function reset() {
    send("Putting it back on automatic", () => clearPipelineOverride(jobId));
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 flex items-center gap-1 px-2 py-1 text-left text-[11px] font-semibold text-muted-foreground"
      >
        <Move className="h-3 w-3 shrink-0" />
        {asked ?? "Move"}
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
          onClick={() => move(place.stage, place.status, place.label)}
          className="rounded px-1.5 py-2 text-left text-xs hover:bg-accent/50"
        >
          {place.label}
        </button>
      ))}

      {overridden && (
        <button
          type="button"
          onClick={reset}
          className="mt-1 rounded px-1.5 py-2 text-left text-xs font-semibold text-primary"
        >
          Put it back on automatic
        </button>
      )}

      <button
        type="button"
        onClick={() => setOpen(false)}
        className="mt-0.5 px-1.5 py-2 text-left text-xs text-muted-foreground"
      >
        Cancel
      </button>

      {error && <p className="px-1.5 text-xs text-destructive">{error}</p>}
    </div>
  );
}
