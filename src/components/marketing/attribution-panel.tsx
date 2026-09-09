import { CHANNEL_LABEL, CONFIDENCE_LABEL, type AttributionTotals } from "@/lib/attribution";
import type { AttributedJob } from "@/lib/data/attribution";

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

/**
 * Where the money came from, and where it honestly cannot be traced.
 *
 * The two absences sit below the channels and are deliberately not drawn as
 * two more bars: a bar labelled "Unknown" beside a bar labelled "Door hangers"
 * invites somebody to compare them, and they are not the same kind of thing --
 * one is a result and the other is the absence of one.
 *
 * The inferred share is printed on the channel that carries it rather than in a
 * footnote, because the whole point of separating it is that somebody about to
 * move a budget should have to read it.
 */
export function AttributionPanel({
  totals,
  health,
  jobs,
}: {
  totals: AttributionTotals;
  health: string[];
  jobs: AttributedJob[];
}) {
  const traced = totals.totalJobs - totals.unknown.jobs - totals.unattributed.jobs;

  return (
    <section className="space-y-4">
      {health.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          {health.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      <p className="text-sm text-muted-foreground">
        {traced} of {totals.totalJobs} sold jobs can be traced to something. The money is what was actually
        received, net of refunds — not what was invoiced.
      </p>

      {totals.channels.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing is traceable to a channel yet.</p>
      ) : (
        <ul className="space-y-2">
          {totals.channels.map((c) => (
            <li key={c.channel} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{CHANNEL_LABEL[c.channel]}</span>
                <span className="text-sm font-semibold tabular-nums">{money(c.revenueCents)}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {c.jobs} {c.jobs === 1 ? "job" : "jobs"}
                {c.inferredJobs > 0 && (
                  <>
                    {" · "}
                    <span className="text-amber-700 dark:text-amber-300">
                      {c.inferredJobs} of them ({money(c.inferredRevenueCents)}) worked out rather than recorded
                    </span>
                  </>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-dashed border-border p-3">
          <p className="text-sm font-medium">Could not be told apart</p>
          <p className="text-lg font-semibold tabular-nums">{money(totals.unknown.revenueCents)}</p>
          <p className="text-xs text-muted-foreground">
            {totals.unknown.jobs} {totals.unknown.jobs === 1 ? "job" : "jobs"}. More than one campaign reached the
            address in range, and nothing recorded which one worked. Not a recording problem — campaigns overlapped.
          </p>
        </div>
        <div className="rounded-lg border border-dashed border-border p-3">
          <p className="text-sm font-medium">Nothing recorded</p>
          <p className="text-lg font-semibold tabular-nums">{money(totals.unattributed.revenueCents)}</p>
          <p className="text-xs text-muted-foreground">
            {totals.unattributed.jobs} {totals.unattributed.jobs === 1 ? "job" : "jobs"}. No source on the job and
            no campaign near the address. This one is fixable: ask on the call.
          </p>
        </div>
      </div>

      <details className="rounded-lg border border-border p-3">
        <summary className="cursor-pointer text-sm font-medium">Every job, and why it is filed where it is</summary>
        <ul className="mt-2 space-y-1.5">
          {jobs.map((job) => (
            <li key={job.jobId} className="text-sm">
              <span className="font-medium">{job.label}</span>{" "}
              <span className="text-muted-foreground">
                — {job.attribution.channel ? CHANNEL_LABEL[job.attribution.channel] : CONFIDENCE_LABEL[job.attribution.confidence]}
                {job.revenueCents > 0 ? ` · ${money(job.revenueCents)}` : " · nothing received yet"}
              </span>
              <span className="block text-xs text-muted-foreground">{job.attribution.because}</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
