"use client";

import { useState, useTransition } from "react";
import { Link2, SplitSquareHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { STAGE_COLOR, STAGE_LABEL } from "@/lib/house-relationship";
import { settleAsDifferent, settleAsSameHouse, type ActionResult } from "@/lib/actions/match-review-actions";
import type { MatchReviewForScreen } from "@/lib/data/match-reviews";

/**
 * The county's near misses, one question each.
 *
 * Ours on the left, the county's on the right, and what rides on ours in
 * between. The two buttons are the two possible answers. Nothing here merges
 * on its own: that is the whole reason the question exists.
 */
export function MatchReviewList({ reviews }: { reviews: MatchReviewForScreen[] }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function run(work: () => Promise<ActionResult<{ message: string }>>) {
    setError(null);
    setNote(null);
    startTransition(async () => {
      const result = await work();
      if (result.ok) setNote(result.value.message);
      else setError(result.error);
    });
  }

  if (reviews.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        The county has no open questions about our houses.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {note && <p className="text-sm text-emerald-700">{note}</p>}

      {reviews.map((review) => (
        <div key={review.id} className="flex flex-col gap-3 rounded-xl border border-border p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ours</p>
              <p className="font-medium">{review.houseAddress}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {review.eventCount > 0 && (
                  <span
                    className="rounded-full px-2 py-0.5 font-semibold text-white"
                    style={{ backgroundColor: STAGE_COLOR[review.stage] }}
                  >
                    {STAGE_LABEL[review.stage]}
                    {review.eventCount > 1 && ` · ${review.eventCount} events`}
                  </span>
                )}
                {review.contacts.length > 0 && <span>{review.contacts.join(", ")}</span>}
              </div>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">The county says</p>
              <p className="font-medium">{review.incomingAddress}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {Math.round(review.score * 100)}% alike
                {review.parcelId ? ` · parcel ${review.parcelId}` : ""}
                {!review.hasPin && " · no pin kept; created on the next import if different"}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={isPending} onClick={() => run(() => settleAsSameHouse(review.id))}>
              <Link2 className="mr-1 h-3.5 w-3.5" />
              Same house, link it
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => run(() => settleAsDifferent(review.id))}
            >
              <SplitSquareHorizontal className="mr-1 h-3.5 w-3.5" />
              Different house, add it
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
