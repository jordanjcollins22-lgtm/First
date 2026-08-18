"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, ClipboardCheck, Clock, Loader2, ThumbsDown, ThumbsUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  cancelWalkthroughRequest,
  requestWalkthrough,
  reviewWalkthrough,
} from "@/lib/actions/walkthrough-actions";
import {
  currentWalkthrough,
  minutesWaiting,
  WALKTHROUGH_STATUS_LABELS,
  type WalkthroughShape,
} from "@/lib/walkthrough";
import type { JobWalkthrough } from "@/types/domain";

/**
 * The account manager's walk, before the tools go away.
 *
 * Sign-off was the crew's own call, so the client was the first person to find
 * a problem. This puts a second pair of eyes on the site while the van is
 * still open — a snag caught now costs ten minutes, the same snag next week
 * costs a trip.
 *
 * Both sides live in one panel because on a phone the crew and the manager are
 * looking at the same screen, often standing next to each other.
 */
export function WalkthroughPanel({
  jobId,
  walkthroughs,
  canRequest,
  requestLockReason,
  canReview,
  namesById,
}: {
  jobId: string;
  /** Newest first. */
  walkthroughs: JobWalkthrough[];
  canRequest: boolean;
  requestLockReason: string | null;
  /** Whether the person looking is the one who decides. */
  canReview: boolean;
  namesById: Record<string, string>;
}) {
  const [note, setNote] = useState("");
  const [notes, setNotes] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const current = currentWalkthrough(walkthroughs as WalkthroughShape[]) as JobWalkthrough | null;
  const pending = current?.status === "requested";
  const approved = current?.status === "approved";
  const rejected = current?.status === "rejected";

  function run(work: () => Promise<{ ok: boolean; message?: string }>) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await work();
      if (result.ok) {
        setMessage(result.message ?? "Done.");
        setNote("");
        setNotes("");
        setRejecting(false);
      } else {
        setError(result.message ?? "That didn't work.");
      }
    });
  }

  return (
    <section
      className={`rounded-xl border p-4 backdrop-blur-md ${
        approved
          ? "border-emerald-600/40 bg-emerald-50/40"
          : rejected
            ? "border-destructive/40 bg-destructive/5"
            : pending
              ? "border-amber-500/50 bg-amber-50/50"
              : "border-white/60 bg-card/60"
      }`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <ClipboardCheck className="h-4 w-4" />
          Manager walkthrough
        </h2>
        {current && (
          <span className="rounded-full border border-border bg-secondary/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {WALKTHROUGH_STATUS_LABELS[current.status]}
          </span>
        )}
      </div>

      {!current && (
        <p className="mb-3 text-xs text-muted-foreground">
          Before the tools go away, the account manager walks the job. Anything they find now costs ten
          minutes — the same thing found by the client next week costs a trip back.
        </p>
      )}

      {/* ------------------------------------------------------------ status */}
      {pending && current && (
        <div className="mb-3 text-xs">
          <p className="flex items-center gap-1.5 font-semibold text-amber-900">
            <Clock className="h-3.5 w-3.5" />
            Asked {minutesWaiting(current)} min ago
            {current.requested_by && namesById[current.requested_by]
              ? ` by ${namesById[current.requested_by]}`
              : ""}
          </p>
          {current.requested_note && (
            <p className="mt-0.5 text-muted-foreground">{current.requested_note}</p>
          )}
          <p className="mt-1 font-medium text-amber-900">Keep the tools out until this is decided.</p>
        </div>
      )}

      {approved && current && (
        <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
          <CheckCircle2 className="h-4 w-4" />
          Approved
          {current.reviewed_by && namesById[current.reviewed_by] ? ` by ${namesById[current.reviewed_by]}` : ""}
          {current.reviewed_at && ` · ${new Date(current.reviewed_at).toLocaleDateString()}`}
        </p>
      )}

      {rejected && current && (
        <div className="mb-3 rounded-lg border border-destructive/40 bg-destructive/5 p-2.5 text-xs">
          <p className="font-semibold text-destructive">Changes needed before you leave</p>
          {current.review_notes && <p className="mt-0.5">{current.review_notes}</p>}
        </div>
      )}

      {/* ---------------------------------------------------- manager decides */}
      {pending && canReview && (
        <div className="mb-3 rounded-lg border border-border bg-background/60 p-3">
          {rejecting ? (
            <>
              <label className="flex flex-col gap-1 text-xs font-medium">
                What needs fixing
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Edging loose by the gate, mulch short on the north bed"
                  autoFocus
                />
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  className="min-h-11 sm:min-h-9"
                  disabled={isPending}
                  onClick={() => run(() => reviewWalkthrough(jobId, false, notes))}
                >
                  {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Send back
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="min-h-11 sm:min-h-9"
                  disabled={isPending}
                  onClick={() => setRejecting(false)}
                >
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="mb-2 text-xs font-medium">Your call — the crew is waiting.</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="min-h-11 flex-1 sm:min-h-9 sm:flex-none"
                  disabled={isPending}
                  onClick={() => run(() => reviewWalkthrough(jobId, true, notes || null))}
                >
                  {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  <ThumbsUp className="mr-1.5 h-3.5 w-3.5" />
                  Approve
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="min-h-11 flex-1 sm:min-h-9 sm:flex-none"
                  disabled={isPending}
                  onClick={() => setRejecting(true)}
                >
                  <ThumbsDown className="mr-1.5 h-3.5 w-3.5" />
                  Needs work
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* -------------------------------------------------------- crew asks */}
      {canRequest ? (
        <>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Anything to flag?
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional — e.g. couldn't reach the far corner"
            />
          </label>
          <Button
            type="button"
            className="mt-2 min-h-11 w-full sm:w-auto"
            disabled={isPending}
            onClick={() => run(() => requestWalkthrough(jobId, note))}
          >
            {isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {rejected ? "Fixed — walk it again" : "Ask the manager to walk it"}
          </Button>
        </>
      ) : (
        !pending && !approved && requestLockReason && (
          <p className="text-[11px] text-muted-foreground">{requestLockReason}</p>
        )
      )}

      {pending && !canReview && (
        <button
          type="button"
          disabled={isPending}
          onClick={() => run(() => cancelWalkthroughRequest(jobId))}
          className="mt-1 flex min-h-8 items-center text-[11px] text-muted-foreground hover:text-destructive"
        >
          Withdraw the request
        </button>
      )}

      {/* History matters: what was wrong the first time, and whether the
          second walk passed. */}
      {walkthroughs.length > 1 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">
            Earlier walks ({walkthroughs.length - 1})
          </summary>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {walkthroughs.slice(1).map((w) => (
              <li key={w.id} className="rounded-md border border-border p-2 text-[11px]">
                <span className="font-medium">{WALKTHROUGH_STATUS_LABELS[w.status]}</span>
                {w.reviewed_at && ` · ${new Date(w.reviewed_at).toLocaleDateString()}`}
                {w.review_notes && <p className="text-muted-foreground">{w.review_notes}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      {message && <p className="mt-2 text-xs text-emerald-700">{message}</p>}
    </section>
  );
}
