"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronLeft, MapPin, Navigation } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { directionsUrl, progressOf, type Stop } from "@/lib/route-walk";
import { setMarketingPlayStatus } from "@/lib/actions/marketing-actions";

/**
 * Walking a round, on a phone, in a street.
 *
 * One question on the screen at a time: which house next. The whole list is
 * there underneath for somebody who wants to see how far there is to go, but
 * the top of the screen is the next address and a button that opens it in
 * maps — because the person holding this has a bag of hangers in the other
 * hand and is not going to scroll.
 *
 * Position is kept here rather than written to the database on every door. A
 * hundred writes from a phone with one bar is a hundred chances to fail at
 * something that does not matter; what matters is the round being marked done
 * at the end, and that is one write.
 */
export function RouteWalker({
  playId,
  zoneName,
  mode,
  doors,
  park,
  walked,
}: {
  playId: string;
  zoneName: string | null;
  mode: string | null;
  doors: Stop[];
  park: { lat: number; lng: number } | null;
  walked: boolean;
}) {
  const [done, setDone] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const progress = progressOf(doors, done);
  const run = progress.next ? [progress.next, ...progress.upcoming] : [];
  const nextUrl = directionsUrl(progress.next ? [progress.next] : []);
  const runUrl = directionsUrl(run);
  const parkUrl = park ? `https://www.google.com/maps/dir/?api=1&destination=${park.lat},${park.lng}` : null;

  async function finish() {
    setError(null);
    setFinishing(true);
    const result = await setMarketingPlayStatus(playId, "done");
    setFinishing(false);
    if (!result.ok) setError(result.error);
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-5">
      <Link href="/my-day" className="flex items-center gap-1 text-sm text-muted-foreground">
        <ChevronLeft className="h-4 w-4" /> My Day
      </Link>

      <div>
        <h1 className="text-xl font-bold">{zoneName ?? "Door hanger round"}</h1>
        <p className="text-sm text-muted-foreground">
          {progress.done} of {progress.total} doors
          {mode ? ` · on ${mode === "foot" ? "foot" : mode === "scooter" ? "a scooter" : "wheels"}` : ""}
        </p>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress.percent}%` }} />
        </div>
      </div>

      {!walked && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
          This zone has not been walked by the router yet, so the doors are in the order they were picked rather
          than the order they are best walked in.
        </p>
      )}

      {progress.finished ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-6 text-center">
          <CheckCircle2 className="h-10 w-10 text-primary" />
          <p className="text-lg font-semibold">That&apos;s the round</p>
          <p className="text-sm text-muted-foreground">All {progress.total} doors done.</p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="button" className="h-12 w-full" disabled={finishing} onClick={finish}>
            {finishing ? "Saving…" : "Mark the round done"}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-xl border-2 border-primary bg-primary/5 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-primary">Next door</p>
          <p className="text-lg font-semibold leading-snug">{progress.next?.address}</p>

          <div className="grid grid-cols-2 gap-2">
            {nextUrl && (
              <a
                href={nextUrl}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-12 items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
              >
                <Navigation className="h-4 w-4" /> Take me there
              </a>
            )}
            <Button type="button" variant="outline" className="min-h-12" onClick={() => setDone(done + 1)}>
              Done — next
            </Button>
          </div>

          {/* One tap that covers the next several doors rather than one. On a
              street of terraces the useful unit is the street, not the house. */}
          {runUrl && run.length > 1 && (
            <a href={runUrl} target="_blank" rel="noreferrer" className="text-center text-xs text-primary underline">
              Open the next {run.length} in one go
            </a>
          )}

          {done > 0 && (
            <button type="button" onClick={() => setDone(done - 1)} className="text-xs text-muted-foreground underline">
              Back one
            </button>
          )}
        </div>
      )}

      {parkUrl && done === 0 && (
        <a
          href={parkUrl}
          target="_blank"
          rel="noreferrer"
          className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-border text-sm font-medium"
        >
          <MapPin className="h-4 w-4" /> Where to park
        </a>
      )}

      <details className="rounded-lg border border-border p-3">
        <summary className="cursor-pointer text-sm font-medium">The whole round</summary>
        <ol className="mt-2 flex flex-col gap-1 text-sm">
          {doors.map((door, i) => (
            <li
              key={door.id}
              className={cn(
                "flex items-baseline gap-2",
                i < done && "text-muted-foreground line-through",
                i === done && "font-semibold text-primary"
              )}
            >
              <span className="w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
              {door.address}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
