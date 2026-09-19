"use client";

import { useState } from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";
import {
  daysWaiting,
  STATE_BLURB,
  STATE_LABEL,
  type BoardEvaluation,
  type EvaluationState,
} from "@/lib/evaluation-board";
import type { EvaluationBoard } from "@/lib/data/evaluation-board";

/**
 * Every evaluation, and the ones somebody still owes.
 *
 * Owed first and open by default, because it is the only part of this screen
 * with money leaking out of it: somebody drove to a house, spent an hour
 * measuring it, and no proposal ever went out. The cost is already sunk and
 * the revenue never arrives.
 *
 * Grouped by name above the list, because "six are unwritten" is a statistic
 * and "Jace has four, the oldest from the 2nd" is something somebody does
 * about it this afternoon.
 */
export function EvaluationBoardView({ board }: { board: EvaluationBoard }) {
  const [tab, setTab] = useState<EvaluationState>(
    board.needsSubmitting.length > 0 ? "needs-submitting" : "upcoming"
  );

  const tabs: { key: EvaluationState; rows: BoardEvaluation[] }[] = [
    { key: "needs-submitting", rows: board.needsSubmitting },
    { key: "upcoming", rows: board.upcoming },
    { key: "submitted", rows: board.submitted },
  ];

  const shown = tabs.find((entry) => entry.key === tab)?.rows ?? [];

  return (
    <div className="flex flex-col gap-3">
      {/* Louder than the late list, and above it. A late write-up is somebody
          being busy; this is an evaluation that will never be written, because
          the person holding it does not visit properties. */}
      {board.misassigned.length > 0 && (
        <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-3">
          <h3 className="text-sm font-semibold">
            {board.misassigned.length} assigned to somebody who doesn&apos;t do evaluations
          </h3>
          <ul className="mt-1.5 flex flex-col gap-1">
            {board.misassigned.map((evaluation) => (
              <li key={evaluation.jobId} className="text-xs">
                <Link href={`/jobs/${evaluation.jobId}`} className="underline">
                  {evaluation.customerName ?? "No name"}
                </Link>{" "}
                is on {evaluation.assignedToName ?? "somebody"}
                {(() => {
                  const waiting = daysWaiting(evaluation, board.now);
                  return waiting != null && waiting > 0 ? `, ${waiting} days now` : "";
                })()}
                . Reassign it or it never gets written.
              </li>
            ))}
          </ul>
        </div>
      )}

      {board.owners.some((owner) => owner.owed > 0) && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
          <h3 className="text-sm font-semibold">Who owes a write-up</h3>
          <ul className="mt-1.5 flex flex-col gap-1">
            {board.owners
              .filter((owner) => owner.owed > 0)
              .map((owner) => (
                <li key={owner.assignedToId ?? "none"} className="text-xs">
                  <span className="font-medium">{owner.name}</span>
                  {" — "}
                  {owner.owed} to submit
                  {owner.oldestDays != null && `, the oldest ${owner.oldestDays} days ago`}
                  {owner.upcoming > 0 && `, and ${owner.upcoming} coming up`}
                  {owner.doesEvaluations === false && " — doesn't do evaluations"}
                </li>
              ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {tabs.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => setTab(entry.key)}
            className={cn(
              "min-h-9 rounded-full border px-3 text-xs",
              tab === entry.key
                ? "border-primary bg-primary/10 font-medium text-primary"
                : "border-border text-muted-foreground hover:bg-accent"
            )}
          >
            {STATE_LABEL[entry.key]}
            {entry.rows.length > 0 && ` (${entry.rows.length})`}
          </button>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">{STATE_BLURB[tab]}</p>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-white/60 bg-card/60 p-4 text-sm text-muted-foreground backdrop-blur-md">
          Nothing here.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {shown.map((evaluation) => (
            <Row key={evaluation.jobId} evaluation={evaluation} now={board.now} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({ evaluation, now }: { evaluation: BoardEvaluation; now: string }) {
  const waiting = daysWaiting(evaluation, now);

  return (
    <li>
      <Link
        href={`/jobs/${evaluation.jobId}`}
        className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-xl border border-white/60 bg-card/60 px-3 py-2.5 backdrop-blur-md hover:bg-accent/50"
      >
        <span className="text-sm font-medium">{evaluation.customerName ?? "No name"}</span>
        {evaluation.address && (
          <span className="text-xs text-muted-foreground">{evaluation.address}</span>
        )}
        {evaluation.assignedToName && (
          <span className="text-xs text-muted-foreground">{evaluation.assignedToName}</span>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {evaluation.at
            ? new Date(evaluation.at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })
            : "No date yet"}
        </span>
        {/* The only number on the row worth colouring. A write-up three weeks
            late is a different problem from one that is a day late. */}
        {waiting != null && waiting > 0 && (
          <span className="w-full text-xs font-medium text-amber-700 dark:text-amber-500">
            {waiting} day{waiting === 1 ? "" : "s"} since the visit, nothing submitted
          </span>
        )}
      </Link>
    </li>
  );
}
