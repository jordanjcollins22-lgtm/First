import Link from "next/link";
import { Clock, MessageSquarePlus } from "lucide-react";

import type { PersonOpenTime } from "@/lib/data/open-time";
import { blockLabel, describePlay, minutesLabel, playFor, verdictLabel } from "@/lib/open-time";

/**
 * One person's open time, and what to do with it.
 *
 * The hours between today's evaluations are listed with a play for each,
 * and the last week is scored by what was done in the open hours, so a
 * quiet week between visits reads as a number rather than a feeling.
 */
export function OpenTimePanel({ me }: { me: PersonOpenTime }) {
  const open = me.score.openMinutes;
  return (
    <section className="mb-6 rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Clock className="h-4 w-4" />
          Open time today
        </h2>
        <span className="text-sm font-semibold">{open > 0 ? minutesLabel(open) : "None"}</span>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {me.appointments.length === 0
          ? "No evaluations booked today. The whole day is for getting the next ones."
          : `${me.appointments.length} evaluation${me.appointments.length === 1 ? "" : "s"} today. The hours between them are where the next jobs come from.`}
      </p>

      {me.blocks.length > 0 && (
        <ol className="mt-3 flex flex-col gap-2">
          {me.blocks.map((b) => (
            <li key={b.startsAt} className="rounded-lg border border-border bg-background/70 p-3">
              <p className="text-sm font-medium">
                {blockLabel(b)} <span className="font-normal text-muted-foreground">({minutesLabel(b.minutes)})</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {b.before && b.after ? `Between ${b.before} and ${b.after}.` : b.after ? `Before ${b.after}.` : b.before ? `After ${b.before}.` : ""}
              </p>
              <p className="mt-1 text-xs">
                <span className="font-semibold">The play:</span> {describePlay(playFor(b.minutes))}
              </p>
            </li>
          ))}
        </ol>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
        <Stat label="Comments today" value={me.today.comments} />
        <Stat label="DM replies today" value={me.today.dms} />
        <Stat label="Links sent today" value={me.today.links} />
        <Stat label="Booked from you, 7 days" value={me.week.counts.bookings} />
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Last 7 days: {minutesLabel(me.week.openMinutes)} open, {me.week.score.actions} actions
        {me.week.score.perOpenHour != null ? `, ${me.week.score.perOpenHour} an open hour` : ""}. {verdictLabel(me.week.score.verdict)}.
      </p>

      <Link
        href="/admin/outreach"
        className="mt-3 flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm font-medium hover:bg-primary/10"
      >
        <MessageSquarePlus className="h-4 w-4 text-primary" />
        Start with a screenshot
      </Link>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-background/70 px-2 py-2">
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

/** The office's view: everyone with open time, and what they did with it. */
export function TeamOpenTimePanel({ team }: { team: PersonOpenTime[] }) {
  if (team.length === 0) return null;
  return (
    <section className="mb-6 rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold">
        <Clock className="h-4 w-4" />
        Open time between evaluations
      </h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Hours not spent on evaluations, and what each person did with them. Comments, replies and links are counted from the outreach board.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="py-1 pr-2 font-medium">Person</th>
              <th className="py-1 pr-2 font-medium">Open today</th>
              <th className="py-1 pr-2 font-medium">Done today</th>
              <th className="py-1 pr-2 font-medium">Open, 7 days</th>
              <th className="py-1 pr-2 font-medium">Actions, 7 days</th>
              <th className="py-1 pr-2 font-medium">Booked from them</th>
              <th className="py-1 font-medium">Pace</th>
            </tr>
          </thead>
          <tbody>
            {team.map((p) => (
              <tr key={p.profileId} className="border-t border-border">
                <td className="py-1.5 pr-2 font-medium">{p.name}</td>
                <td className="py-1.5 pr-2 tabular-nums">{p.score.openMinutes > 0 ? minutesLabel(p.score.openMinutes) : "None"}</td>
                <td className="py-1.5 pr-2 tabular-nums">
                  {p.today.comments} comments, {p.today.dms} DMs, {p.today.links} links
                </td>
                <td className="py-1.5 pr-2 tabular-nums">{minutesLabel(p.week.openMinutes)}</td>
                <td className="py-1.5 pr-2 tabular-nums">
                  {p.week.score.actions}
                  {p.week.score.perOpenHour != null && <span className="text-muted-foreground"> ({p.week.score.perOpenHour}/hr)</span>}
                </td>
                <td className="py-1.5 pr-2 tabular-nums">{p.week.counts.bookings}</td>
                <td className={`py-1.5 font-medium ${p.week.score.verdict === "idle" ? "text-destructive" : p.week.score.verdict === "slow" ? "text-amber-800" : ""}`}>
                  {verdictLabel(p.week.score.verdict)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
