"use client";

import { CalendarCheck, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import type { OfferedTime } from "@/app/book/times/route";

function formatDay(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

function formatTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * Two or three times, offered rather than listed.
 *
 * A fortnight of free hours is a hundred buttons and a decision the client is
 * not equipped to make — they cannot know we are already four streets away on
 * Tuesday. So the good ones come first, each with the reason it is good, and
 * the full calendar stays one tap away for the person who has a Thursday in
 * mind and will not be talked out of it.
 *
 * The reasons are written from the client's side and name nobody: "we're
 * already close by around then" is true and gives away nothing about whose
 * garden we are in.
 */
export function RecommendedTimes({
  times,
  loading,
  selected,
  onPick,
  onSeeAll,
}: {
  times: OfferedTime[];
  loading: boolean;
  selected: { date: string; time: string } | null;
  onPick: (time: OfferedTime) => void;
  onSeeAll: () => void;
}) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2" aria-busy>
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-[4.5rem] animate-pulse rounded-xl border border-border/60 bg-muted/40" />
        ))}
      </div>
    );
  }

  if (times.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing open in the next two weeks. Pick any time below and we&apos;ll confirm it with you.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {times.map((time) => {
        const isSelected = selected?.date === time.date && selected?.time === time.time;
        return (
          <button
            key={`${time.date}T${time.time}`}
            type="button"
            onClick={() => onPick(time)}
            className={cn(
              "flex min-h-[4.5rem] items-center gap-3 rounded-xl border p-3 text-left transition",
              isSelected
                ? "border-primary bg-primary/10 ring-1 ring-primary"
                : "border-border bg-card hover:border-primary hover:bg-accent/40"
            )}
          >
            <CalendarCheck className={cn("h-5 w-5 shrink-0", isSelected ? "text-primary" : "text-muted-foreground")} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{formatDay(time.date)}</span>
              <span className="block text-sm">{formatTime(time.time)}</span>
              {time.says && <span className="mt-0.5 block text-xs text-primary">{time.says}</span>}
            </span>
          </button>
        );
      })}

      <button type="button" onClick={onSeeAll} className="self-start py-2 text-sm text-muted-foreground underline">
        None of these work — see all times
      </button>
    </div>
  );
}

/** Shown while the times are being worked out, so the step never looks empty. */
export function TimesSpinner() {
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Finding the best times for your address…
    </p>
  );
}
