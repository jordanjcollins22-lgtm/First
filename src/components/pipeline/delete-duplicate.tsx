"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Trash2 } from "lucide-react";

import { deleteDuplicateJob, markNotDuplicate } from "@/lib/actions/delete-job-actions";

/**
 * One press to take a copied booking off the board.
 *
 * Says what it is a copy of, asks once, and deletes. The action refuses a
 * job with money or work on it, and says so in place.
 */
export function DeleteDuplicate({
  jobId,
  keeper,
  copies = [],
  compact = false,
}: {
  jobId: string;
  /** The job this one copies, when it is the copy. */
  keeper: { jobId: string; label: string } | null;
  /** The copies of this one, when it is the job kept. */
  copies?: { jobId: string; label: string }[];
  compact?: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function keep() {
    setNote(null);
    start(async () => {
      const result = await markNotDuplicate(jobId);
      if (result.ok) router.refresh();
      else setNote(result.message);
    });
  }

  function remove() {
    setNote(null);
    start(async () => {
      const result = await deleteDuplicateJob(jobId);
      if (result.ok) {
        setConfirming(false);
        router.refresh();
        if (!compact) router.push("/pipeline");
      } else {
        setNote(result.message);
      }
    });
  }

  return (
    <div className={compact ? "mt-1 text-[11px]" : "mt-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"}>
      {keeper && (
        <p className={compact ? "font-medium text-amber-700" : "font-medium"}>
          Looks like a duplicate of{" "}
          <Link href={`/jobs/${keeper.jobId}`} className="underline">
            {keeper.label}
          </Link>
          {compact ? "" : "'s other job at this address"}.
        </p>
      )}
      {!keeper && copies.length > 0 && (
        <p className="font-medium">
          Booked again at this address:{" "}
          {copies.map((c, i) => (
            <span key={c.jobId}>
              {i > 0 ? ", " : ""}
              <Link href={`/jobs/${c.jobId}`} className="underline">
                the other job
              </Link>
            </span>
          ))}
          . Delete the copy from its own page, or this one here.
        </p>
      )}
      {confirming ? (
        <div className={`flex flex-wrap items-center gap-2 ${compact ? "mt-0.5" : "mt-2"}`}>
          <span>Delete this copy? Nothing on it is kept.</span>
          <button type="button" onClick={remove} disabled={pending} className="inline-flex min-h-8 items-center gap-1 rounded-md bg-destructive px-2.5 text-xs font-semibold text-white disabled:opacity-60">
            {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
            Yes, delete it
          </button>
          <button type="button" onClick={() => setConfirming(false)} disabled={pending} className="min-h-8 rounded-md border border-border px-2.5 text-xs">
            Keep it
          </button>
        </div>
      ) : (
        <span className={`flex flex-wrap items-center gap-3 ${compact ? "" : "mt-1"}`}>
          <button type="button" onClick={() => setConfirming(true)} className={`inline-flex min-h-8 items-center gap-1 text-destructive hover:underline ${compact ? "text-[11px]" : "text-xs font-medium"}`}>
            <Trash2 className="h-3 w-3" />
            {keeper ? "Delete this duplicate" : "Delete this job"}
          </button>
          {keeper && (
            <button type="button" onClick={keep} disabled={pending} className={`inline-flex min-h-8 items-center gap-1 text-muted-foreground hover:underline ${compact ? "text-[11px]" : "text-xs font-medium"}`}>
              Not a duplicate, it&apos;s more work
            </button>
          )}
        </span>
      )}
      {note && <p className="mt-1 text-xs text-destructive">{note}</p>}
    </div>
  );
}
