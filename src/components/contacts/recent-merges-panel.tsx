"use client";

import { useState, useTransition } from "react";
import { Loader2, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { undoContactMerge } from "@/lib/actions/contact-actions";

export interface MergeRecord {
  id: string;
  keptName: string;
  mergedName: string;
  movedProperties: number;
  mergedAt: string;
  undoneAt: string | null;
}

function when(iso: string): string {
  const date = new Date(iso);
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} hr ago`;
  return date.toLocaleDateString();
}

/**
 * The last few merges, and a way back from each.
 *
 * A merge deletes a contact. That is fine when somebody is checking each pair
 * carefully, and it stops being fine the moment a few thousand imported
 * contacts arrive and the duplicate list runs to hundreds — because then
 * merging is fast, and fast means one of them is wrong.
 *
 * Shown whether or not anything has been merged recently is pointless, so the
 * panel only appears once there is something in it. But once there is, it
 * stays visible rather than living behind a menu: an undo somebody has to go
 * looking for is one they find after they have merged forty more.
 */
export function RecentMergesPanel({ merges }: { merges: MergeRecord[] }) {
  const [undone, setUndone] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (merges.length === 0) return null;

  function undo(id: string) {
    setError(null);
    setWorking(id);
    startTransition(async () => {
      const result = await undoContactMerge(id);
      if (result.ok) setUndone((prev) => new Set(prev).add(id));
      else setError(result.message);
      setWorking(null);
    });
  }

  return (
    <section className="rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <h2 className="text-sm font-semibold">Recently merged</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Merging deletes one of the two. If the wrong pair went together, put it back here — the contact,
        its properties, and anything the merge filled in on the one that stayed.
      </p>

      {error && <p className="mb-2 text-xs text-destructive">{error}</p>}

      <ul className="flex flex-col gap-1.5">
        {merges.map((merge) => {
          const isUndone = merge.undoneAt !== null || undone.has(merge.id);
          return (
            <li
              key={merge.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-background/60 p-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm">
                  <span className="font-medium">{merge.mergedName}</span>
                  <span className="text-muted-foreground"> into </span>
                  <span className="font-medium">{merge.keptName}</span>
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {when(merge.mergedAt)}
                  {merge.movedProperties > 0 &&
                    ` · ${merge.movedProperties} propert${merge.movedProperties === 1 ? "y" : "ies"} moved`}
                </p>
              </div>

              {isUndone ? (
                <span className="shrink-0 text-xs font-medium text-emerald-700">Put back</span>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => undo(merge.id)}
                >
                  {working === merge.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Undo2 className="h-3.5 w-3.5" />
                  )}
                  Undo
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
