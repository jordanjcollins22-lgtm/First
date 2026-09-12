import Link from "next/link";

import {
  BUCKET_LABEL,
  EVALUATION_BUCKETS,
  bucketCounts,
  inBucket,
  type SalesEvaluation,
} from "@/lib/sales-evaluations";

function when(value: string | null): string {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No date";
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/**
 * What every evaluation still owes.
 *
 * Done-with-no-proposal is first because it is the expensive one: somebody
 * drove to a house and measured it, and the only thing between that and money
 * is a proposal nobody has written.
 */
export function EvaluationBuckets({ evaluations, now }: { evaluations: SalesEvaluation[]; now: string }) {
  const counts = bucketCounts(evaluations, now);

  return (
    <div className="space-y-5">
      {EVALUATION_BUCKETS.map((bucket) => {
        const rows = inBucket(evaluations, bucket, now);
        return (
          <section key={bucket}>
            <h2 className="mb-1.5 text-sm font-semibold">
              {BUCKET_LABEL[bucket]}
              <span className="ml-2 text-xs font-normal tabular-nums text-muted-foreground">{counts[bucket]}</span>
            </h2>
            {rows.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                {bucket === "awaiting-proposal"
                  ? "Nothing measured is waiting on a proposal."
                  : bucket === "overdue"
                    ? "Nothing has been left unwritten."
                    : "Nothing booked."}
              </p>
            ) : (
              <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60">
                {rows.map((row) => (
                  <li key={row.jobId}>
                    <Link
                      href={`/jobs/${row.jobId}`}
                      className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2.5 hover:bg-accent"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {row.customerName ?? "No client"}
                          {row.jobNumber != null && (
                            <span className="ml-2 font-mono text-xs text-muted-foreground">#{row.jobNumber}</span>
                          )}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {row.address ?? "No address"}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-xs text-muted-foreground">
                        <span className="block">{when(row.at)}</span>
                        {row.assignedToName && <span className="block">{row.assignedToName}</span>}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
