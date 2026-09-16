"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, HardHat } from "lucide-react";

import { cn } from "@/lib/utils";
import { dateShort } from "@/lib/time-zone";

const STATUS_LABEL: Record<string, string> = {
  approved: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  estimating: "Not sold yet",
  quoted: "Not sold yet",
};
import type { CrewStanding } from "@/lib/crew-leaderboard";
import type { CrewBoards } from "@/lib/data/crew-leaderboard";

/**
 * Who gets the work done, and done right, best first.
 *
 * Completed is the column the rank is built on; mistakes and callbacks are
 * what break a tie, because a job done twice was not done. Nothing here is
 * money, so everybody on a crew can see where they stand.
 */
export function CrewLeaderboard({ boards, meId, compact = false, canOpenAll = false }: { boards: CrewBoards; meId: string | null; compact?: boolean; canOpenAll?: boolean }) {
  const [window, setWindow] = useState<"recent" | "allTime">("recent");
  const [open, setOpen] = useState<string | null>(null);
  const standings = boards[window];
  const canOpen = (id: string) => canOpenAll || id === meId;

  return (
    <section className="rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <HardHat className="h-4 w-4 text-amber-600" />
          Crew leaderboard
        </h2>
        <div className="flex gap-1.5">
          {(["recent", "allTime"] as const).map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setWindow(w)}
              className={cn(
                "min-h-8 rounded-full border px-3 text-xs",
                window === w ? "border-primary bg-primary/10 font-medium text-primary" : "border-border text-muted-foreground hover:bg-accent"
              )}
            >
              {w === "recent" ? "Last 90 days" : "All time"}
            </button>
          ))}
        </div>
      </div>
      {!compact && (
        <p className="mb-2 text-xs text-muted-foreground">
          Ranked by jobs completed, then fewest mistakes, then fewest callbacks, then most finished on time. A mistake is a return trip
          caused by our workmanship or design; a callback is any return trip; a complaint is a quality, damage or complaint issue the
          client raised.
        </p>
      )}

      {standings.length === 0 ? (
        <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">Nobody has been on a job in this window.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="p-2 font-medium">#</th>
                <th className="p-2 font-medium">Who</th>
                <th className="p-2 text-right font-medium">Jobs</th>
                <th className="p-2 text-right font-medium">Days</th>
                <th className="p-2 text-right font-medium">Completed</th>
                <th className="p-2 text-right font-medium">On time</th>
                <th className="p-2 text-right font-medium">Mistakes</th>
                <th className="p-2 text-right font-medium">Callbacks</th>
                <th className="p-2 text-right font-medium">Complaints</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((s: CrewStanding) => (
                <Fragment key={s.profileId}>
                <tr
                  onClick={canOpen(s.profileId) ? () => setOpen(open === s.profileId ? null : s.profileId) : undefined}
                  className={cn("border-b border-border last:border-0", s.profileId === meId && "bg-primary/5", canOpen(s.profileId) && "cursor-pointer hover:bg-accent/40")}
                >
                  <td className="p-2 font-semibold tabular-nums text-muted-foreground">{s.rank}</td>
                  <td className="p-2">
                    {canOpen(s.profileId) && (open === s.profileId ? <ChevronUp className="mr-1 inline h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="mr-1 inline h-3.5 w-3.5 text-muted-foreground" />)}
                    <span className="font-medium">{s.name}</span>
                    {s.profileId === meId && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}
                    {s.led > 0 && <span className="ml-1.5 text-xs text-muted-foreground">led {s.led}</span>}
                  </td>
                  <td className="p-2 text-right tabular-nums">{s.jobs}</td>
                  <td className="p-2 text-right tabular-nums">
                    {s.daysWorked}
                    {s.daysScheduled > s.daysWorked && <span className="ml-1 text-xs text-muted-foreground">of {s.daysScheduled}</span>}
                  </td>
                  <td className={cn("p-2 text-right font-semibold tabular-nums", s.completed > 0 && "text-emerald-700")}>{s.completed}</td>
                  <td className="p-2 text-right tabular-nums">
                    {s.onTime}
                    {s.late > 0 && <span className="ml-1 text-xs text-amber-800">{s.late} late</span>}
                    {s.onTimeRate != null && <span className="ml-1 text-xs text-muted-foreground">{Math.round(s.onTimeRate * 100)}%</span>}
                  </td>
                  <td className={cn("p-2 text-right tabular-nums", s.mistakes > 0 && "font-semibold text-destructive")}>{s.mistakes}</td>
                  <td className={cn("p-2 text-right tabular-nums", s.callbacks > 0 && "text-amber-800")}>{s.callbacks}</td>
                  <td className={cn("p-2 text-right tabular-nums", s.complaints > 0 && "text-amber-800")}>{s.complaints}</td>
                </tr>
                {open === s.profileId && (
                  <tr className="border-b border-border bg-muted/20">
                    <td colSpan={9} className="p-2">
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Every job they were on, and how it went</p>
                      <ul className="flex flex-col gap-1">
                        {s.pipeline.map((line) => (
                          <li key={line.jobId} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded bg-background/70 px-2 py-1 text-xs">
                            <span
                              className={cn(
                                "rounded px-1.5 py-0.5 font-medium",
                                line.status === "completed" ? "bg-emerald-100 text-emerald-800" : line.status === "in_progress" ? "bg-sky-100 text-sky-800" : "bg-muted text-muted-foreground"
                              )}
                            >
                              {STATUS_LABEL[line.status] ?? line.status}
                            </span>
                            <Link href={`/jobs/${line.jobId}`} className="font-medium hover:underline">
                              {line.clientName}
                            </Link>
                            {line.address && <span className="text-muted-foreground">{line.address}</span>}
                            {line.lead && <span className="text-muted-foreground">led</span>}
                            {line.lastDay && <span className="text-muted-foreground">{dateShort(line.lastDay)}</span>}
                            <span className="text-muted-foreground">
                              {line.daysWorked} of {line.daysScheduled} day{line.daysScheduled === 1 ? "" : "s"}
                            </span>
                            {line.onTime === true && <span className="text-emerald-700">on time</span>}
                            {line.onTime === false && <span className="text-amber-800">late</span>}
                            {line.mistakes > 0 && <span className="font-medium text-destructive">{line.mistakes} mistake{line.mistakes === 1 ? "" : "s"}</span>}
                            {line.callbacks > 0 && <span className="text-amber-800">{line.callbacks} callback{line.callbacks === 1 ? "" : "s"}</span>}
                            {line.complaints > 0 && <span className="text-amber-800">{line.complaints} complaint{line.complaints === 1 ? "" : "s"}</span>}
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
