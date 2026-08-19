import Link from "next/link";

import { STATE_LABELS, type CommissionSummary } from "@/lib/commission";

function money(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

/**
 * One person's commission, job by job.
 *
 * Three totals rather than one, because "what am I owed" and "what is stuck"
 * are different questions with different next actions. Payable is money to
 * hand over. Held is a job to go and unblock. Accruing is work still running,
 * shown so nobody has to guess what a month is shaping up to be.
 */
export function CommissionPanel({
  summary,
  title,
  subtitle,
}: {
  summary: CommissionSummary;
  title?: string;
  subtitle?: string;
}) {
  return (
    <section className="rounded-xl border border-white/60 bg-card/60 p-3 backdrop-blur-md">
      {title && (
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <h3 className="font-semibold">{title}</h3>
          <span className="text-xs text-muted-foreground">{summary.pct}% of collected</span>
        </div>
      )}
      {subtitle && <p className="mb-2 text-xs text-muted-foreground">{subtitle}</p>}

      <div className="mb-3 grid grid-cols-3 gap-2">
        <Tile label="Payable" value={money(summary.earned)} strong />
        <Tile label="Held" value={money(summary.held)} alert={summary.held > 0} />
        <Tile label="Accruing" value={money(summary.accruing)} />
      </div>

      {summary.lines.length === 0 ? (
        <p className="text-xs text-muted-foreground">No jobs on this book yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {summary.lines.map((line) => (
            <li key={line.jobId}>
              <Link
                href={`/jobs/${line.jobId}`}
                className={`block rounded-lg border p-2.5 hover:bg-accent/50 ${
                  line.state === "held" ? "border-amber-400/70 bg-amber-50/60" : "border-border bg-background/60"
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium">{line.customerName}</span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">{money(line.amount)}</span>
                </div>
                <p className="truncate text-xs text-muted-foreground">{line.address}</p>
                <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                  <span
                    className={
                      line.state === "earned"
                        ? "font-semibold text-emerald-700"
                        : line.state === "held"
                          ? "font-semibold text-amber-800"
                          : ""
                    }
                  >
                    {STATE_LABELS[line.state]}
                  </span>
                  <span>{money(line.collected)} collected</span>
                  {line.outstanding > 0 && <span>{money(line.outstanding)} still out</span>}
                </p>
                {line.reason && <p className="text-[11px] text-muted-foreground">{line.reason}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 text-[11px] text-muted-foreground">
        Commission is a share of money actually received, not of what was quoted, and becomes payable once the
        job is finished with no tickets open on it.
      </p>
    </section>
  );
}

function Tile({ label, value, strong, alert }: { label: string; value: string; strong?: boolean; alert?: boolean }) {
  return (
    <div
      className={`rounded-lg border p-2 ${
        alert ? "border-amber-400/70 bg-amber-50/70" : "border-border bg-background/50"
      }`}
    >
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`tabular-nums ${strong ? "text-lg font-bold" : "text-base font-semibold"}`}>{value}</p>
    </div>
  );
}
