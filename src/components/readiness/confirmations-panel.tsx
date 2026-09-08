"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";

import { setConfirmation } from "@/lib/actions/issue-actions";
import type { ConfirmationState } from "@/lib/readiness";

type Kind = "materials" | "equipment" | "access";

const ASKS: { kind: Kind; label: string; ask: string; hint: string }[] = [
  {
    kind: "materials",
    label: "Materials",
    ask: "Are the materials for this job in hand?",
    hint: "Read from the stock behind the services sold. Confirm by hand if you have looked.",
  },
  {
    kind: "equipment",
    label: "Equipment",
    ask: "Is the equipment available?",
    hint: "Read from the tools the services need. Confirm by hand if you have looked.",
  },
  {
    kind: "access",
    label: "Access",
    ask: "Gate codes, parking, where the truck goes, whether the client must be home?",
    hint: "There is nowhere else to read this from, so it starts unconfirmed on every job.",
  },
];

/**
 * The positive evidence a job is actually ready.
 *
 * Not a checkbox somebody ticks to make a warning go away: each of these is a
 * question with three honest answers, and "we have not looked" is one of them.
 * The state the app worked out is shown alongside, with where it came from, so
 * confirming by hand is a person overruling a stock count they can see rather
 * than filling in a blank.
 */
export function ConfirmationsPanel({
  jobId,
  states,
  sources,
  notes,
}: {
  jobId: string;
  states: Record<Kind, ConfirmationState>;
  sources: Record<Kind, string>;
  notes?: Partial<Record<Kind, string | null>>;
}) {
  const router = useRouter();
  const [note, setNote] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save(kind: Kind, state: ConfirmationState) {
    setError(null);
    start(async () => {
      const result = await setConfirmation({ jobId, kind, state, note: note[kind] ?? notes?.[kind] ?? null });
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <section className="rounded-lg border border-border/60">
      <header className="border-b border-border/50 px-3 py-2">
        <h2 className="text-sm font-semibold">Before a crew goes out</h2>
        <p className="text-xs text-muted-foreground">
          A job is not ready because nobody has complained. These are the things somebody has to have checked.
        </p>
      </header>

      <ul className="divide-y divide-border/50">
        {ASKS.map((ask) => {
          const state = states[ask.kind];
          return (
            <li key={ask.kind} className="px-3 py-2.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {ask.label}
                    <span
                      className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        state === "confirmed"
                          ? "bg-emerald-600/15 text-emerald-800 dark:text-emerald-300"
                          : state === "not_required"
                            ? "bg-muted text-muted-foreground"
                            : "bg-amber-500/20 text-amber-900 dark:text-amber-200"
                      }`}
                    >
                      {state === "confirmed" ? "Confirmed" : state === "not_required" ? "Not needed" : "Not confirmed"}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">{ask.ask}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{sources[ask.kind]}</p>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    disabled={pending || state === "confirmed"}
                    onClick={() => save(ask.kind, "confirmed")}
                    className="inline-flex min-h-9 items-center gap-1 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground disabled:opacity-40"
                  >
                    {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Confirm
                  </button>
                  <button
                    type="button"
                    disabled={pending || state === "not_required"}
                    onClick={() => save(ask.kind, "not_required")}
                    className="min-h-9 rounded-md border border-border px-2.5 text-xs disabled:opacity-40"
                  >
                    Not needed
                  </button>
                  {state !== "required_unconfirmed" && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => save(ask.kind, "required_unconfirmed")}
                      className="min-h-9 px-1 text-[11px] text-muted-foreground underline"
                    >
                      Undo
                    </button>
                  )}
                </div>
              </div>

              {ask.kind === "access" && (
                <input
                  value={note.access ?? notes?.access ?? ""}
                  onChange={(e) => setNote((prev) => ({ ...prev, access: e.target.value }))}
                  placeholder="Gate code 4821, park on the street, dog in the back"
                  className="mt-1.5 min-h-10 w-full rounded-md border border-border bg-background px-2 text-xs"
                />
              )}
              <p className="mt-1 text-[10px] text-muted-foreground">{ask.hint}</p>
            </li>
          );
        })}
      </ul>
      {error && <p className="px-3 pb-2 text-xs text-destructive">{error}</p>}
    </section>
  );
}
