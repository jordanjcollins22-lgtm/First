"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldAlert } from "lucide-react";

import { overrideCheck, withdrawOverride } from "@/lib/actions/issue-actions";
import type { GateKey } from "@/lib/readiness";

/**
 * Letting a failed check past, with a reason attached to a name.
 *
 * There is no way to do this without typing why. The reason is stored on the
 * job and shown beside the check from then on, so the exception is as visible
 * afterwards as the failure was.
 *
 * Somebody without the role does not get a disabled button — they get told
 * what to do instead, which is raise an issue.
 */
export function OverrideControl({
  jobId,
  gate,
  checkKey,
  checkLabel,
  overridden,
  canOverride,
}: {
  jobId: string;
  gate: GateKey;
  checkKey: string;
  checkLabel: string;
  overridden: boolean;
  canOverride: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!canOverride) {
    return overridden ? null : (
      <span className="shrink-0 text-[11px] text-muted-foreground">A manager can let this past</span>
    );
  }

  if (overridden) {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await withdrawOverride({ jobId, gate, checkKey });
            if (!result.ok) setError(result.error);
            else router.refresh();
          })
        }
        className="shrink-0 text-[11px] text-muted-foreground underline"
      >
        Lift the exception
      </button>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex shrink-0 items-center gap-1 rounded border border-amber-500/50 px-2 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-500/10 dark:text-amber-200"
      >
        <ShieldAlert className="h-3 w-3" /> Let past
      </button>
    );
  }

  return (
    <div className="w-full shrink-0 sm:w-64">
      <label className="block text-[11px] font-medium" htmlFor={`why-${checkKey}`}>
        Why is &ldquo;{checkLabel}&rdquo; being let past?
      </label>
      <textarea
        id={`why-${checkKey}`}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        placeholder="The client rang and confirmed the side gate is open."
        className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
      />
      <div className="mt-1 flex items-center gap-2">
        <button
          type="button"
          disabled={pending || reason.trim().length < 4}
          onClick={() =>
            start(async () => {
              const result = await overrideCheck({ jobId, gate, checkKey, reason });
              if (!result.ok) setError(result.error);
              else {
                setOpen(false);
                setReason("");
                router.refresh();
              }
            })
          }
          className="inline-flex items-center gap-1 rounded bg-amber-600 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
        >
          {pending && <Loader2 className="h-3 w-3 animate-spin" />} Record it
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-[11px] text-muted-foreground underline">
          Cancel
        </button>
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">
        Kept on the job with your name and the time. The check goes on reading as failed.
      </p>
      {error && <p className="mt-1 text-[11px] text-destructive">{error}</p>}
    </div>
  );
}
