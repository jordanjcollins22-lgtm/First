"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, ChevronDown, ChevronUp, Loader2, RotateCcw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { approveScopeRecommendation, declineScopeRecommendation, loadScopeReviews } from "@/lib/actions/scope-review-actions";
import type { ZoneReview } from "@/lib/scope-review";

/**
 * The evaluator's note beside the words we propose to send, zone by zone.
 *
 * The note is shown as written and never changes. Under it is the
 * recommendation for the client, with two buttons. Approve puts it on the
 * proposal. Decline asks why, and the answer is what the next round is
 * written from; the declined one stays on the record underneath.
 */
export function ScopeReviewPanel({ jobId, onSettled }: { jobId: string; onSettled: (allSettled: boolean) => void }) {
  const [reviews, setReviews] = useState<ZoneReview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function take(result: Awaited<ReturnType<typeof loadScopeReviews>>) {
    if (result.ok) {
      setReviews(result.value.reviews);
      onSettled(result.value.reviews.every((r) => r.settled));
      setError(null);
    } else {
      setError(result.message);
    }
    setLoading(false);
  }

  async function refresh() {
    take(await loadScopeReviews(jobId));
  }

  useEffect(() => {
    // Once, on open; the buttons refresh after themselves. The state lands
    // when the answer does, not in the effect itself.
    let alive = true;
    loadScopeReviews(jobId).then((result) => {
      if (alive) take(result);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  if (loading && !reviews) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Writing the recommended scope from the evaluator&apos;s notes…
      </p>
    );
  }
  if (error && !reviews) return <p className="text-xs text-destructive">{error}</p>;
  if (!reviews || reviews.length === 0) return null;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-amber-400/40 bg-amber-400/5 p-3">
      <div>
        <p className="text-sm font-semibold">Scope review</p>
        <p className="text-xs text-muted-foreground">
          What the evaluator wrote stays as written. What the client reads is the recommendation, once you approve it.
        </p>
      </div>
      {reviews.map((review) => (
        <ZoneReviewCard key={review.zoneIndex} review={review} onChanged={refresh} />
      ))}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function ZoneReviewCard({ review, onChanged }: { review: ZoneReview; onChanged: () => Promise<void> }) {
  const [pending, start] = useTransition();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const current = review.current;

  function approve() {
    if (!current) return;
    setError(null);
    start(async () => {
      const result = await approveScopeRecommendation(current.id);
      if (!result.ok) setError(result.message);
      await onChanged();
    });
  }

  function decline() {
    if (!current) return;
    setError(null);
    start(async () => {
      const result = await declineScopeRecommendation(current.id, reason);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setDeclining(false);
      setReason("");
      if (!result.value.next) setError("Declined, but a new recommendation could not be written. Try again in a moment.");
      await onChanged();
    });
  }

  return (
    <div className={cn("rounded-md border bg-background/70 p-3", review.settled ? "border-emerald-500/40" : "border-border")}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold">{review.zoneName}</p>
        {review.settled ? (
          <span className="flex items-center gap-1 text-xs font-medium text-emerald-700">
            <Check className="h-3.5 w-3.5" /> Approved{current ? `, round ${current.round}` : ""}
          </span>
        ) : (
          <span className="text-xs font-medium text-amber-800">Needs a decision</span>
        )}
      </div>

      <div className="mt-2 rounded bg-muted/40 px-2 py-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Evaluator&apos;s note, as written</p>
        <p className="whitespace-pre-wrap text-sm">{review.note}</p>
      </div>

      {current ? (
        <div className="mt-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Recommended scope of work{current.round > 1 ? `, round ${current.round}` : ""}
            {review.noteChanged && <span className="ml-1 normal-case text-amber-800">(the note changed since; a fresh one is being written)</span>}
          </p>
          <p className="whitespace-pre-wrap text-sm">{current.recommendedText}</p>
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">No recommendation written yet.</p>
      )}

      {current && current.status === "pending" && !declining && (
        <div className="mt-2 flex gap-2">
          <Button type="button" size="sm" disabled={pending} onClick={approve}>
            {pending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}
            Approve
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setDeclining(true)}>
            <X className="mr-1 h-3.5 w-3.5" />
            Decline
          </Button>
        </div>
      )}

      {declining && (
        <div className="mt-2 flex flex-col gap-2">
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why? For example: too vague, mention the drainage, don't promise the edging."
            className="min-h-[64px] text-sm"
          />
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={pending || reason.trim().length < 3} onClick={decline}>
              {pending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-1 h-3.5 w-3.5" />}
              Send back for a new one
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setDeclining(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}

      {review.history.length > 0 && (
        <div className="mt-2">
          <button type="button" onClick={() => setShowHistory((v) => !v)} className="flex items-center gap-1 text-xs text-muted-foreground underline">
            {showHistory ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {review.history.length} earlier round{review.history.length === 1 ? "" : "s"}
          </button>
          {showHistory && (
            <ul className="mt-1 flex flex-col gap-1.5">
              {review.history.map((h) => (
                <li key={h.id} className="rounded border border-border/60 px-2 py-1.5 text-xs">
                  <p className="text-muted-foreground">
                    Round {h.round} · {h.status}
                    {h.declineReason ? ` · declined: ${h.declineReason}` : ""}
                  </p>
                  <p className="whitespace-pre-wrap">{h.recommendedText}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
