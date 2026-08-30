"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Move } from "lucide-react";

import { clearPipelineOverride, moveJobOnPipeline } from "@/lib/actions/pipeline-move-actions";
import { movableTo, type PipelineStage } from "@/lib/pipeline";
import { openDispute, resolveDispute } from "@/lib/actions/dispute-actions";
import { DISPUTE_KINDS, kindLabel, type DisputeKind } from "@/lib/dispute";

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
  disputed = false,
}: {
  jobId: string;
  /** Already sitting somewhere somebody put it. */
  overridden: boolean;
  /** Already in dispute, so the move on offer is resolving it. */
  disputed?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // What we have asked for, shown until the board comes back saying it. React
  // drops it when the transition ends, which is the moment the fresh board
  // arrives — so the echo never outlives the answer it was standing in for.
  const [asked, setAsked] = useOptimistic<string | null>(null);
  // Raising a dispute is two steps: the kind, then the reason. A card saying
  // "Legal" and nothing else is a card somebody has to open, and the column
  // exists so the board says what is wrong without anybody opening anything.
  const [raising, setRaising] = useState<DisputeKind | null>(null);
  const [reason, setReason] = useState("");

  function raise() {
    if (!raising) return;
    setRaising(null);
    send(`Moving to Disputes — ${kindLabel(raising)}`, async () => {
      const result = await openDispute(jobId, raising, reason);
      if (result.ok) setReason("");
      return result;
    });
  }

  function settle() {
    send("Marking it sorted", () => resolveDispute(jobId));
  }

  // Any action that answers with the same ok/message shape can drive the
  // echo — moving a card, raising a dispute, settling one.
  function send(echo: string, work: () => Promise<{ ok: boolean; message?: string }>) {
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
      setError(result.message ?? "Couldn't do that.");
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

  // Second step of raising a dispute. A card that says "Legal" and nothing
  // else is a card somebody has to open, and the column exists so the board
  // says what is wrong without anybody opening anything.
  if (raising) {
    return (
      <div className="mt-1.5 flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-2">
        <p className="text-[11px] font-semibold">What is the problem?</p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          autoFocus
          placeholder="Solicitor's letter about the retaining wall"
          className="w-full rounded-md border border-input bg-card/80 px-2 py-1.5 text-xs"
        />
        <p className="text-[11px] text-muted-foreground">
          Nothing automatic goes to this client while it is open. You can still message them
          yourself.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!reason.trim()}
            onClick={raise}
            className="rounded bg-destructive px-2 py-1.5 text-xs font-semibold text-destructive-foreground disabled:opacity-50"
          >
            Put it in Disputes
          </button>
          <button
            type="button"
            onClick={() => setRaising(null)}
            className="px-1.5 py-1.5 text-xs text-muted-foreground"
          >
            Back
          </button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mt-1.5 flex flex-col gap-1 rounded-lg border border-border bg-background p-2">
      {disputed ? (
        <>
          <p className="text-[11px] font-semibold text-muted-foreground">This one is in dispute</p>
          <button
            type="button"
            onClick={settle}
            className="rounded px-1.5 py-2 text-left text-xs font-semibold text-primary hover:bg-accent/50"
          >
            Mark it sorted, and put the job back
          </button>
          <p className="px-1.5 text-[11px] text-muted-foreground">
            It goes back where the job actually is, and the client starts hearing from us again.
          </p>
        </>
      ) : (
        <>
          <p className="text-[11px] font-semibold text-muted-foreground">Move this to</p>
          {movableTo()
            .filter((place) => place.stage !== "disputes")
            .map((place) => (
              <button
                key={place.label}
                type="button"
                onClick={() => move(place.stage, place.status, place.label)}
                className="rounded px-1.5 py-2 text-left text-xs hover:bg-accent/50"
              >
                {place.label}
              </button>
            ))}

          {/* Its own step rather than four more rows in the list above: this
              one stops the client hearing from us, which is not something to
              do with the same tap as moving a card between columns. */}
          <p className="mt-1 border-t border-border pt-1.5 text-[11px] font-semibold text-muted-foreground">
            Something is wrong with this job
          </p>
          {DISPUTE_KINDS.map((kind) => (
            <button
              key={kind.value}
              type="button"
              onClick={() => setRaising(kind.value)}
              className="rounded px-1.5 py-2 text-left text-xs hover:bg-accent/50"
            >
              <span className="font-semibold text-destructive">{kind.label}</span>{" "}
              <span className="text-muted-foreground">{kind.blurb}</span>
            </button>
          ))}
        </>
      )}

      {overridden && !disputed && (
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
