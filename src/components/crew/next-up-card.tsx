"use client";

import { useState, useTransition } from "react";
import { CalendarPlus, Check, Clock, MapPin } from "lucide-react";

import { Button } from "@/components/ui/button";
import { requestEarlyStart } from "@/lib/actions/early-start-actions";
import {
  canRequestEarlyStart,
  describeRequest,
  type EarlyStartRequest,
  type UpcomingVisit,
} from "@/lib/early-start";
import type { CrewEvent, Stop } from "@/lib/crew-day";

function when(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? date
    : d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

/**
 * What to do with the rest of the afternoon.
 *
 * Appears only once every stop booked for today is finished. Shown earlier it
 * is an invitation to skip the job they are standing on; the point of it is
 * the hours that are left *after* the work is done.
 *
 * The button asks — it does not start. The account manager is the one who
 * told the customer when we were coming, and a crew arriving two days early
 * unannounced is a complaint rather than a favour.
 */
export function NextUpCard({
  today,
  visit,
  existing,
  stops,
  events,
}: {
  today: string;
  visit: UpcomingVisit | null;
  existing: EarlyStartRequest | null;
  stops: Stop[];
  events: CrewEvent[];
}) {
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const finishedJobIds = events
    .filter((e) => e.kind === "finished_job" && e.jobId)
    .map((e) => e.jobId as string);

  // Nothing booked and nothing to say about it — no empty card on the screen.
  if (!visit) return null;

  const verdict = canRequestEarlyStart({ today, visit, existing, stops, finishedJobIds });
  const standing = existing && existing.sessionId === visit.sessionId ? existing : null;
  const status = sent ? "Waiting on the account manager." : describeRequest(standing);

  return (
    <section className="rounded-2xl border border-border bg-card/60 p-4">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Next up
      </p>

      <p className="text-base font-bold">{visit.customerName}</p>
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <MapPin className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{visit.address}</span>
      </p>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
        <Clock className="h-3.5 w-3.5 shrink-0" />
        Booked for {when(visit.startsOn)}
      </p>
      {visit.purpose && <p className="mt-1 text-sm text-muted-foreground">{visit.purpose}</p>}

      {status ? (
        <p className="mt-3 flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium">
          <Check className="h-4 w-4 shrink-0 text-primary" />
          {status}
        </p>
      ) : !verdict.ok ? (
        // The reason, never a silently greyed-out button. A crew member who
        // cannot tell why a button is dead stops pressing buttons.
        <p className="mt-3 text-sm text-muted-foreground">{verdict.reason}</p>
      ) : asking ? (
        <div className="mt-3 flex flex-col gap-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Anything they should know? (optional)"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              className="flex-1"
              onClick={() => setAsking(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="flex-1"
              disabled={pending}
              onClick={() => {
                setError(null);
                start(async () => {
                  const result = await requestEarlyStart({ sessionId: visit.sessionId, note });
                  if (result.ok) setSent(true);
                  else setError(result.message);
                });
              }}
            >
              {pending ? "Sending…" : "Send request"}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          size="lg"
          className="mt-3 w-full gap-2"
          onClick={() => setAsking(true)}
        >
          <CalendarPlus className="h-4 w-4" />
          Ask to start this now
        </Button>
      )}

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </section>
  );
}
