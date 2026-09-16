"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, Trophy } from "lucide-react";

import { cn } from "@/lib/utils";
import { EVALUATOR_STAGE_LABEL, type EvaluatorStage, type EvaluatorStanding } from "@/lib/evaluation-leaderboard";
import { dateShort } from "@/lib/time-zone";

const STAGE_STYLE: Record<EvaluatorStage, string> = {
  booked: "bg-sky-100 text-sky-800",
  cancelled: "bg-muted text-muted-foreground",
  visited: "bg-amber-100 text-amber-800",
  proposal: "bg-violet-100 text-violet-800",
  closed: "bg-emerald-100 text-emerald-800",
  declined: "bg-rose-100 text-rose-800",
};
import type { EvaluationBoards } from "@/lib/data/evaluation-leaderboard";

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

/**
 * Who turns visits into jobs, best first.
 *
 * Closed is the column the rank is built on. The others say why: visits
 * done, how many became a proposal and how fast, and how many of those
 * were accepted. The money columns are the owner's.
 */
export function EvaluationLeaderboard({ boards, showMoney, meId }: { boards: EvaluationBoards; showMoney: boolean; meId: string | null }) {
  const [window, setWindow] = useState<"recent" | "allTime">("recent");
  const [open, setOpen] = useState<string | null>(null);
  const standings = boards[window];
  // The owner opens anyone's pipeline; everybody else opens their own.
  const canOpen = (id: string) => showMoney || id === meId;

  return (
    <section className="rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Trophy className="h-4 w-4 text-amber-600" />
          Evaluation leaderboard
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
      <p className="mb-2 text-xs text-muted-foreground">
        Ranked by jobs closed, then what they sold, then proposals written, then visits done. A visit counts on the day it happened.
      </p>

      {standings.length === 0 ? (
        <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">No evaluations with somebody on them in this window.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className={cn("w-full border-collapse text-sm", showMoney ? "min-w-[760px]" : "min-w-[600px]")}>
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="p-2 font-medium">#</th>
                <th className="p-2 font-medium">Who</th>
                <th className="p-2 text-right font-medium">Visits</th>
                <th className="p-2 text-right font-medium">Proposals</th>
                <th className="p-2 text-right font-medium">Days to write</th>
                <th className="p-2 text-right font-medium">Closed</th>
                <th className="p-2 text-right font-medium">Close rate</th>
                {showMoney && <th className="p-2 text-right font-medium">Sold</th>}
                {showMoney && <th className="p-2 text-right font-medium">Collected</th>}
              </tr>
            </thead>
            <tbody>
              {standings.map((s: EvaluatorStanding) => (
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
                    {(s.cancelled > 0 || s.upcoming > 0) && (
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        {[s.upcoming > 0 ? `${s.upcoming} booked` : null, s.cancelled > 0 ? `${s.cancelled} cancelled` : null].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </td>
                  <td className="p-2 text-right tabular-nums">{s.evaluations}</td>
                  <td className="p-2 text-right tabular-nums">
                    {s.proposals}
                    {s.awaitingProposal > 0 && (
                      <span className="ml-1 text-xs text-amber-800" title="Visits done with no proposal written yet">
                        {s.awaitingProposal} unwritten
                      </span>
                    )}
                  </td>
                  <td className="p-2 text-right tabular-nums text-muted-foreground">{s.daysToProposal == null ? "—" : s.daysToProposal}</td>
                  <td className={cn("p-2 text-right font-semibold tabular-nums", s.closed > 0 && "text-emerald-700")}>{s.closed}</td>
                  <td className="p-2 text-right tabular-nums text-muted-foreground">{s.closeRate == null ? "—" : `${Math.round(s.closeRate * 100)}%`}</td>
                  {showMoney && <td className="p-2 text-right tabular-nums">{s.sold > 0 ? money(s.sold) : "—"}</td>}
                  {showMoney && <td className="p-2 text-right tabular-nums">{s.collected > 0 ? money(s.collected) : "—"}</td>}
                </tr>
                {open === s.profileId && (
                  <tr className="border-b border-border bg-muted/20">
                    <td colSpan={showMoney ? 9 : 7} className="p-2">
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Pipeline: every visit and where it got to</p>
                      <ul className="flex flex-col gap-1">
                        {s.pipeline.map((line) => (
                          <li key={line.jobId} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded bg-background/70 px-2 py-1 text-xs">
                            <span className={cn("rounded px-1.5 py-0.5 font-medium", STAGE_STYLE[line.stage])}>{EVALUATOR_STAGE_LABEL[line.stage]}</span>
                            <Link href={`/jobs/${line.jobId}`} className="font-medium hover:underline">
                              {line.clientName}
                            </Link>
                            {line.address && <span className="text-muted-foreground">{line.address}</span>}
                            {line.visitDate && <span className="text-muted-foreground">visit {dateShort(line.visitDate)}</span>}
                            {line.daysToProposal != null && <span className="text-muted-foreground">proposal after {line.daysToProposal} day{line.daysToProposal === 1 ? "" : "s"}</span>}
                            {showMoney && line.proposalTotal != null && line.proposalTotal > 0 && <span>{money(line.proposalTotal)}</span>}
                            {showMoney && line.collected > 0 && <span className="text-emerald-700">{money(line.collected)} paid</span>}
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
