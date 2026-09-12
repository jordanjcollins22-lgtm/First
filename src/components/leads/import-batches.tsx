"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { removeImportBatch } from "@/lib/actions/prospect-actions";
import { removeLabel, type BatchSummary } from "@/lib/import-batches";

/**
 * Undoing an import that was wrong.
 *
 * Re-importing a corrected file does not replace a bad one. Prospects are
 * matched on their address, so corrected addresses arrive as new rows while
 * the wrong ones stay put, and the list ends up twice as long with half of it
 * rubbish. Taking the bad batch out first is what makes the re-import clean.
 *
 * Rows anybody has actually worked are never removed, and the panel says so
 * before anything is pressed rather than after.
 */
export function ImportBatches({ batches }: { batches: BatchSummary[] }) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (batches.length === 0) return null;

  function remove(name: string) {
    setMessage(null);
    start(async () => {
      const result = await removeImportBatch(name);
      setConfirming(null);
      setMessage(
        result.ok
          ? `Removed ${result.removed}.${result.kept > 0 ? ` Kept ${result.kept} with history.` : ""}`
          : result.message
      );
    });
  }

  return (
    <section className="rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <h3 className="text-sm font-semibold">Imported lists</h3>
      <p className="mb-3 mt-0.5 text-xs text-muted-foreground">
        Importing a corrected file adds to these rather than replacing them, because rows are
        matched on their address. If a list was wrong, remove it here first, then import the
        corrected one.
      </p>

      <ul className="flex flex-col gap-2">
        {batches.map((batch) => {
          const asking = confirming === batch.name;
          return (
            <li key={batch.name} className="rounded-lg border border-border p-2.5">
              <p className="text-sm font-medium">{batch.name}</p>
              <p className="text-xs text-muted-foreground">
                {batch.total} address{batch.total === 1 ? "" : "es"}
                {batch.keepingReason
                  ? `, ${batch.keeping} of which ${batch.keepingReason}`
                  : ""}
              </p>

              {asking ? (
                <div className="mt-2 flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="flex-1"
                    disabled={pending}
                    onClick={() => setConfirming(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="flex-1"
                    disabled={pending}
                    onClick={() => remove(batch.name)}
                  >
                    {pending ? "Removing…" : "Yes, remove them"}
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2 w-full"
                  disabled={pending || batch.removable.length === 0}
                  onClick={() => setConfirming(batch.name)}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  {removeLabel(batch)}
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      {message && <p className="mt-2 text-xs">{message}</p>}
    </section>
  );
}
