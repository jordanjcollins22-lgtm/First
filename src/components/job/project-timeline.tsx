import { Check, Circle, Clock } from "lucide-react";

import { BUSINESS_TIME_ZONE } from "@/lib/time-zone";
import type { Milestone } from "@/lib/project-closeout";

/** A day on its own ("2026-09-30") is a calendar date, not midnight in London. */
function when(value: string, timeZone: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(`${value}T00:00:00Z`));
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

/**
 * Where the project got to, and when, in one column. Booked, evaluated,
 * site map in, proposal sent, signed, scheduled, crew there, the client's
 * approval and the sign-off. Each with its date, or not yet.
 */
export function ProjectTimeline({ milestones, timeZone }: { milestones: Milestone[]; timeZone?: string | null }) {
  const zone = timeZone || BUSINESS_TIME_ZONE;
  // Past the last thing done, only the next one is worth a line of its own.
  const lastDone = milestones.reduce((last, m, i) => (m.done ? i : last), -1);
  return (
    <ol className="flex flex-col gap-1.5 rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      {milestones.map((m, i) => {
        const next = !m.done && i === lastDone + 1;
        return (
          <li key={m.key} className={`flex items-start gap-2 text-sm ${!m.done && !next ? "text-muted-foreground/70" : ""}`}>
            {m.done && !m.upcoming ? (
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            ) : m.upcoming || next ? (
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            ) : (
              <Circle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <span className={`flex-1 ${m.done || next ? "font-medium" : ""}`}>{m.label}</span>
            <span className="shrink-0 text-right text-xs text-muted-foreground tabular-nums">
              {m.at ? `${m.upcoming ? "for " : ""}${when(m.at, zone)}` : m.detail ?? (m.done ? "" : "Not yet")}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
