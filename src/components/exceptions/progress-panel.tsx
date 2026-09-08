"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import {
  PROGRESS_LABEL,
  PROGRESS_STATES,
  progressNeedsReason,
  summariseProgress,
  type ProgressState,
  type ProgressUnit,
} from "@/lib/exceptions";
import { recordProgress } from "@/lib/actions/exception-actions";

const TONE: Record<ProgressState, string> = {
  complete: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200",
  in_progress: "bg-sky-500/15 text-sky-800 dark:text-sky-200",
  partial: "bg-amber-500/15 text-amber-900 dark:text-amber-200",
  cannot_perform: "bg-destructive/15 text-destructive",
  skipped: "bg-muted text-muted-foreground",
  not_started: "bg-muted text-muted-foreground",
};

/**
 * Which bits of the job got done.
 *
 * The thing this is really for is the fourth zone that did not. A job used to
 * be finished or not finished, so a crew that did three quarters of it had
 * nowhere to say so, and the difference was carried in somebody's head as far
 * as the invoice. Anything short of done asks for a reason before it will
 * save -- here and in the database -- because "three of four" on its own still
 * ends in a phone call.
 */
export function ProgressPanel({
  jobId,
  units,
  workSessionId = null,
}: {
  jobId: string;
  units: ProgressUnit[];
  workSessionId?: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [state, setState] = useState<ProgressState>("complete");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const summary = summariseProgress(units);

  function save(unit: ProgressUnit) {
    setError(null);
    start(async () => {
      const result = await recordProgress({
        jobId,
        unitKind: unit.unitKind,
        unitKey: unit.unitKey,
        unitLabel: unit.unitLabel,
        state,
        note,
        workSessionId,
      });
      if (!result.ok) setError(result.error);
      else {
        setEditing(null);
        setNote("");
        router.refresh();
      }
    });
  }

  if (units.length === 0) {
    return <p className="text-sm text-muted-foreground">No areas on the site plan yet, so there is nothing to tick off.</p>;
  }

  return (
    <section className="space-y-2">
      {summary.sentence && <p className="text-sm font-medium">{summary.sentence}</p>}
      {summary.accountedFor && !summary.fullyDone && (
        <p className="text-xs text-muted-foreground">
          Everything is accounted for — the parts that were not done have a reason against them.
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <ul className="space-y-2">
        {units.map((unit) => {
          const key = `${unit.unitKind}:${unit.unitKey}`;
          const open = editing === key;
          return (
            <li key={key} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">{unit.unitLabel ?? unit.unitKey}</span>
                <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${TONE[unit.state]}`}>
                  {PROGRESS_LABEL[unit.state]}
                </span>
              </div>
              {unit.note && <p className="mt-1 text-sm text-muted-foreground">{unit.note}</p>}

              {!open ? (
                <button
                  type="button"
                  onClick={() => {
                    setEditing(key);
                    setState(unit.state === "not_started" ? "complete" : unit.state);
                    setNote(unit.note ?? "");
                  }}
                  className="mt-2 min-h-11 rounded-md border border-border px-3 text-sm"
                >
                  {unit.state === "not_started" ? "Record what happened" : "Change it"}
                </button>
              ) : (
                <div className="mt-2 space-y-2">
                  <select
                    value={state}
                    onChange={(e) => setState(e.target.value as ProgressState)}
                    className="min-h-11 w-full rounded-md border border-border bg-background px-2 text-sm"
                  >
                    {PROGRESS_STATES.map((s) => (
                      <option key={s} value={s}>
                        {PROGRESS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                  {progressNeedsReason(state) && (
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={2}
                      placeholder="What stopped this part being finished"
                      className="w-full rounded-md border border-border bg-background p-2 text-sm"
                    />
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={pending || (progressNeedsReason(state) && note.trim() === "")}
                      onClick={() => save(unit)}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
                    >
                      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(null)}
                      className="min-h-11 px-2 text-sm text-muted-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
