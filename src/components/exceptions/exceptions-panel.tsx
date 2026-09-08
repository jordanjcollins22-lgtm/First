"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertOctagon, Check, Loader2 } from "lucide-react";

import { KIND_LABEL, isExceptionOpen, type ExceptionKind } from "@/lib/exceptions";
import { acknowledgeException, dismissException, resolveException } from "@/lib/actions/exception-actions";
import type { JobException } from "@/lib/data/exceptions";

function when(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * What the field has reported on this job, and what came of it.
 *
 * The open ones first, and the ones that stopped a crew above those. Settling
 * one needs a sentence about what was done, for the same reason closing an
 * issue does: a report that closes silently teaches nobody anything, and the
 * next person to hit the same padlocked gate starts from scratch.
 *
 * Somebody who is not allowed to settle a kind still sees it. Hiding the
 * report from a crew member because they cannot decide it is how a crew stops
 * believing that reporting does anything.
 */
export function ExceptionsPanel({
  exceptions,
  canDecide,
}: {
  exceptions: JobException[];
  /** Per kind, from the viewer's roles. Decided on the server. */
  canDecide: Record<string, boolean>;
}) {
  const router = useRouter();
  const [settling, setSettling] = useState<string | null>(null);
  const [word, setWord] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const open = exceptions.filter((e) => isExceptionOpen(e.state));
  const closed = exceptions.filter((e) => !isExceptionOpen(e.state));
  const stopped = open.filter((e) => e.blocksWork).length;

  function settle(id: string, dismissing: boolean) {
    setError(null);
    start(async () => {
      const result = dismissing ? await dismissException(id, word) : await resolveException(id, word);
      if (!result.ok) setError(result.error);
      else {
        setSettling(null);
        setWord("");
        router.refresh();
      }
    });
  }

  function ack(id: string) {
    setError(null);
    start(async () => {
      const result = await acknowledgeException(id);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  if (exceptions.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing has been reported from the field on this job.</p>;
  }

  return (
    <section className="space-y-3">
      {stopped > 0 && (
        <p className="flex items-center gap-1.5 text-sm font-medium text-destructive">
          <AlertOctagon className="h-4 w-4" />
          {stopped === 1 ? "A crew is stopped." : `${stopped} reports say a crew is stopped.`}
        </p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <ul className="space-y-2">
        {open.map((e) => {
          const mine = canDecide[e.kind] === true;
          return (
            <li key={e.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">
                  {KIND_LABEL[e.kind as ExceptionKind]}
                </span>
                {e.blocksWork && (
                  <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-xs font-medium text-destructive">
                    Stopped
                  </span>
                )}
                {e.state === "acknowledged" && (
                  <span className="text-xs text-muted-foreground">
                    Picked up by {e.acknowledgedByName ?? "somebody"}
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm">{e.summary}</p>
              {e.detail && <p className="mt-1 text-sm text-muted-foreground">{e.detail}</p>}
              <p className="mt-1 text-xs text-muted-foreground">
                {e.reportedByName ?? "Somebody"} · {when(e.reportedAt)}
                {e.scopeChangeId ? " · opened a change request" : ""}
              </p>

              {mine && settling !== e.id && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {e.state === "reported" && (
                    <button
                      type="button"
                      onClick={() => ack(e.id)}
                      disabled={pending}
                      className="min-h-11 rounded-md border border-border px-3 text-sm"
                    >
                      I&apos;ve got this
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setSettling(e.id);
                      setWord("");
                    }}
                    className="min-h-11 rounded-md border border-border px-3 text-sm"
                  >
                    Settle it
                  </button>
                </div>
              )}

              {mine && settling === e.id && (
                <div className="mt-2 space-y-2">
                  <textarea
                    value={word}
                    onChange={(ev) => setWord(ev.target.value)}
                    rows={2}
                    placeholder="What was done about it"
                    className="w-full rounded-md border border-border bg-background p-2 text-sm"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={pending || word.trim() === ""}
                      onClick={() => settle(e.id, false)}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
                    >
                      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Sorted
                    </button>
                    <button
                      type="button"
                      disabled={pending || word.trim() === ""}
                      onClick={() => settle(e.id, true)}
                      className="min-h-11 rounded-md border border-border px-3 text-sm disabled:opacity-50"
                    >
                      Not a problem
                    </button>
                    <button
                      type="button"
                      onClick={() => setSettling(null)}
                      className="min-h-11 px-2 text-sm text-muted-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {!mine && (
                <p className="mt-2 text-xs text-muted-foreground">Waiting on somebody who can decide this one.</p>
              )}
            </li>
          );
        })}
      </ul>

      {closed.length > 0 && (
        <details className="rounded-lg border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            {closed.length} settled
          </summary>
          <ul className="mt-2 space-y-2">
            {closed.map((e) => (
              <li key={e.id} className="text-sm">
                <span className="text-muted-foreground">{when(e.reportedAt)}</span> · {KIND_LABEL[e.kind as ExceptionKind]} ·{" "}
                {e.summary}
                {e.resolution && (
                  <span className="block text-xs text-muted-foreground">
                    {e.state === "dismissed" ? "Dismissed" : "Resolved"} by {e.resolvedByName ?? "somebody"}: {e.resolution}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
