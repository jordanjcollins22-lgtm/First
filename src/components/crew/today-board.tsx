"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, ChevronRight, Loader2, MapPin, Navigation, RotateCcw, Truck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { recordCrewEvent, undoLastCrewEvent } from "@/lib/actions/crew-day-actions";
import { directionsUrl, readDay, type CrewEvent, type Stop } from "@/lib/crew-day";

/**
 * The crew's whole screen.
 *
 * One question answered — where am I going next — and one button for when the
 * answer changes. Everything else here is context for that button.
 *
 * There is deliberately no way to report a step out of order: the single
 * action is built from the day's actual state, so the sequence is enforced by
 * there being nothing else to press rather than by a validation message after
 * the fact. The server re-checks anyway, for the phone that has been in a
 * pocket since this morning.
 */
export function TodayBoard({
  stops,
  events,
  personName,
}: {
  stops: Stop[];
  events: CrewEvent[];
  personName: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const day = readDay(events, stops);
  const done = new Set(day.stopsDone);

  /**
   * Attaches a rough position when the phone offers one, and never waits long
   * for it — a crew member in a dead spot still has to be able to tap the
   * button, so location is a bonus on the record, never a gate on it.
   */
  function press(kind: CrewEvent["kind"], jobId: string | null) {
    setError(null);
    startTransition(async () => {
      const position = await currentPosition();
      const result = await recordCrewEvent(kind, jobId, position);
      if (!result.ok) setError(result.message);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <section
        className={`rounded-2xl border p-4 shadow-sm ${
          day.phase === "day_over"
            ? "border-emerald-600/40 bg-emerald-50/60"
            : "border-white/60 bg-card/80 backdrop-blur-md"
        }`}
      >
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {greeting()}, {personName.split(" ")[0]}
        </p>
        <p className="mt-1 text-lg font-bold leading-snug">{day.headline}</p>

        {(day.currentStop ?? day.nextStop) && (
          <StopCallout stop={(day.currentStop ?? day.nextStop)!} phase={day.phase} />
        )}

        {day.action && (
          <Button
            type="button"
            disabled={isPending}
            onClick={() => press(day.action!.kind, day.action!.jobId)}
            className="mt-3 h-14 w-full text-base font-semibold"
          >
            {isPending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <IconFor kind={day.action.kind} />}
            {day.action.label}
          </Button>
        )}

        {error && <p className="mt-2 text-sm font-medium text-destructive">{error}</p>}

        {events.length > 0 && day.phase !== "day_over" && (
          <button
            type="button"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await undoLastCrewEvent();
                if (!result.ok) setError(result.message);
              })
            }
            className="mt-2 flex min-h-9 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Undo last tap
          </button>
        )}
      </section>

      <section>
        <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Today&apos;s stops ({done.size}/{stops.length})
        </h2>

        {stops.length === 0 ? (
          <p className="rounded-xl border border-white/60 bg-card/60 p-4 text-sm text-muted-foreground backdrop-blur-md">
            Nothing booked for you today. Check with the office before you head out.
          </p>
        ) : (
          <ol className="flex flex-col gap-2">
            {stops.map((stop, i) => (
              <StopRow
                key={stop.jobId}
                stop={stop}
                index={i + 1}
                done={done.has(stop.jobId)}
                current={day.currentStop?.jobId === stop.jobId || day.nextStop?.jobId === stop.jobId}
              />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

/** The address, big, with the two things you do with an address. */
function StopCallout({ stop, phase }: { stop: Stop; phase: string }) {
  return (
    <div className="mt-3 rounded-xl border border-border bg-background/70 p-3">
      <p className="text-xs font-medium text-muted-foreground">
        {phase === "on_site" ? "You're here" : "Heading to"}
      </p>
      <p className="text-base font-semibold leading-snug">{stop.address}</p>
      <p className="text-sm text-muted-foreground">{stop.customerName}</p>
      {stop.purpose && <p className="mt-0.5 text-xs text-muted-foreground">{stop.purpose}</p>}

      <div className="mt-2 flex flex-wrap gap-2">
        <a
          href={directionsUrl(stop)}
          target="_blank"
          rel="noreferrer"
          className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground"
        >
          <Navigation className="h-4 w-4" />
          Directions
        </a>
        <Link
          href={`/jobs/${stop.jobId}`}
          className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium"
        >
          <MapPin className="h-4 w-4" />
          The job
        </Link>
      </div>
    </div>
  );
}

function StopRow({
  stop,
  index,
  done,
  current,
}: {
  stop: Stop;
  index: number;
  done: boolean;
  current: boolean;
}) {
  return (
    <li
      className={`flex items-center gap-3 rounded-xl border p-3 ${
        done
          ? "border-emerald-600/40 bg-emerald-50/40"
          : current
            ? "border-primary bg-primary/5"
            : "border-border bg-card/60"
      }`}
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
          done
            ? "bg-emerald-600 text-white"
            : current
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-muted-foreground"
        }`}
      >
        {done ? <Check className="h-4 w-4" /> : index}
      </span>

      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm font-medium ${done ? "text-muted-foreground line-through" : ""}`}>
          {stop.address}
        </p>
        <p className="truncate text-xs text-muted-foreground">{stop.customerName}</p>
      </div>

      {/* Always tappable, even when it isn't the current stop — "show me which
          house that was" is a fair question about any of them. */}
      <a
        href={directionsUrl(stop)}
        target="_blank"
        rel="noreferrer"
        aria-label={`Directions to ${stop.address}`}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border"
      >
        <ChevronRight className="h-4 w-4" />
      </a>
    </li>
  );
}

function IconFor({ kind }: { kind: CrewEvent["kind"] }) {
  const className = "mr-2 h-5 w-5";
  switch (kind) {
    case "arrived_shop":
    case "returned_shop":
      return <Truck className={className} />;
    case "left_shop":
    case "travelling":
      return <Navigation className={className} />;
    case "arrived_job":
      return <MapPin className={className} />;
    case "finished_job":
      return <Check className={className} />;
  }
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Morning";
  if (hour < 17) return "Afternoon";
  return "Evening";
}

/** Best-effort, short-fused. A tap must never wait on a GPS fix. */
async function currentPosition(): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return null;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 3000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
      { timeout: 3000, maximumAge: 60_000 }
    );
  });
}
