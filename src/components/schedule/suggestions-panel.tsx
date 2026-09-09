"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CalendarPlus, CloudRain, Info, Loader2 } from "lucide-react";

import type { MoveSuggestion, Suggestion } from "@/lib/schedule-engine";
import { acceptSuggestion, setScheduleEngineEnabled } from "@/lib/actions/schedule-engine-actions";

function when(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * What the calendar would do, if somebody agreed with it.
 *
 * Every suggestion shows its reasoning and its gaps side by side, and neither
 * is collapsed behind a chevron. The reasoning is there so a person can
 * disagree with a specific step rather than with the machine; the gaps are
 * there because a suggestion that hides what it did not know is a suggestion
 * somebody books and regrets.
 *
 * Nothing on this panel happens without a press. The moves in particular are
 * read-only: a job the weather is about to spoil is flagged and a home is
 * proposed, and moving it is a decision somebody makes on the calendar, where
 * they can see what else is that day.
 */
export function SuggestionsPanel({
  enabled,
  suggestions,
  moves,
  caveats,
  canAccept,
  canToggle,
}: {
  enabled: boolean;
  suggestions: Suggestion[];
  moves: MoveSuggestion[];
  caveats: string[];
  canAccept: boolean;
  canToggle: boolean;
}) {
  const router = useRouter();
  const [taken, setTaken] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function accept(s: Suggestion) {
    setError(null);
    start(async () => {
      const result = await acceptSuggestion({
        jobId: s.jobId,
        date: s.date,
        crewProfileIds: s.crewProfileIds,
        because: s.because,
      });
      if (!result.ok) setError(result.error);
      else {
        setTaken((held) => new Set(held).add(s.jobId));
        router.refresh();
      }
    });
  }

  if (!enabled) {
    return (
      <section className="space-y-2 rounded-xl border border-dashed border-border p-4">
        <h3 className="text-sm font-semibold">Scheduling suggestions</h3>
        <p className="text-sm text-muted-foreground">
          Off. When it is on, it looks four weeks ahead and proposes a day and a crew for each sold job that has
          no date yet, and flags booked work the forecast is about to spoil. It never books anything and never
          moves anything — every suggestion needs somebody to press a button.
        </p>
        {canToggle && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await setScheduleEngineEnabled(true);
                if (!result.ok) setError(result.error);
                else router.refresh();
              })
            }
            className="min-h-11 rounded-lg border border-border px-3 text-sm font-medium"
          >
            Try it
          </button>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Scheduling suggestions</h3>
        {canToggle && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await setScheduleEngineEnabled(false);
                if (!result.ok) setError(result.error);
                else router.refresh();
              })
            }
            className="min-h-9 text-xs text-muted-foreground underline"
          >
            Turn it off
          </button>
        )}
      </div>

      {caveats.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
          {caveats.map((c) => (
            <li key={c} className="flex items-start gap-1.5">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {c}
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {moves.length > 0 && (
        <div className="space-y-2 rounded-lg border border-sky-500/40 bg-sky-500/5 p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <CloudRain className="h-4 w-4" /> The forecast is against {moves.length}{" "}
            {moves.length === 1 ? "booked job" : "booked jobs"}
          </p>
          <ul className="space-y-2">
            {moves.map((m) => (
              <li key={`${m.jobId}-${m.from}`} className="text-sm">
                <Link href={`/jobs/${m.jobId}`} className="font-medium underline">
                  {m.label}
                </Link>{" "}
                <span className="text-muted-foreground">
                  {when(m.from)} → {m.to ? when(m.to) : "nowhere obvious"}
                </span>
                <ul className="mt-0.5 space-y-0.5 text-xs text-muted-foreground">
                  {m.because.map((b, i) => (
                    <li key={`${b}-${i}`}>{b}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Nothing here has been moved. Move it on the calendar, where you can see what else is that day.
          </p>
        </div>
      )}

      {suggestions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Every sold job has a date, or nothing in the next four weeks has the room.
        </p>
      ) : (
        <ul className="space-y-2">
          {suggestions.map((s) => (
            <li key={s.jobId} className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link href={`/jobs/${s.jobId}`} className="text-sm font-medium underline">
                  {s.label}
                </Link>
                <span className="text-sm font-semibold">{when(s.date)}</span>
              </div>
              <p className="text-xs text-muted-foreground">{s.crewNames.join(", ")}</p>

              <ul className="space-y-0.5 text-xs">
                {s.because.map((b, i) => (
                  <li key={`${b}-${i}`}>{b}</li>
                ))}
              </ul>

              {s.unknowns.length > 0 && (
                <ul className="space-y-0.5 text-xs text-amber-700 dark:text-amber-300">
                  {s.unknowns.map((u, i) => (
                    <li key={`${u}-${i}`}>Doesn&apos;t know: {u}</li>
                  ))}
                </ul>
              )}

              {taken.has(s.jobId) ? (
                <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Booked.</p>
              ) : canAccept ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => accept(s)}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />}
                  Book {when(s.date)}
                </button>
              ) : (
                <p className="text-xs text-muted-foreground">A project lead or account manager can book this.</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
