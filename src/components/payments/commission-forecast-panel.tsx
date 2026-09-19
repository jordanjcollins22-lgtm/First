import { money } from "@/lib/inventory-value";
import type { CommissionForecast, QuotedShape } from "@/lib/commission-forecast";

/**
 * What a month of commission costs.
 *
 * The per-person books answer "what do I owe this person for that job",
 * which is the right question when paying somebody and the wrong one when
 * deciding whether to take on another account manager. That decision is about
 * a month: how many sales, how big, and what the commission on them comes to.
 *
 * The middle month leads rather than the average, because one exceptional
 * month should not become the figure a hiring decision is made against. The
 * average is beside it, and a wide gap between the two is itself the finding —
 * it means the months are lumpy and neither number is a promise.
 */
export function CommissionForecastPanel({
  forecast,
  quoted,
}: {
  forecast: CommissionForecast;
  /** What jobs are quoted at, for a business with nothing collected yet. */
  quoted?: QuotedShape;
}) {
  const { sales } = forecast;

  // Nothing has been collected against a job. Commission is paid on money
  // that arrived, so there is genuinely nothing to forecast -- but a business
  // with twenty proposals on file is not one with no idea what a sale is
  // worth, and showing it nothing would be the less useful answer.
  if (sales.jobs === 0) {
    return (
      <div className="space-y-3">
        <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
          No payment has been recorded against a finished job yet, so there is no commission to
          work out. Commission is paid on money that arrived, not on what was quoted. File the
          invoices and cash against their jobs and this fills in on its own.
        </p>

        {quoted && quoted.proposals > 0 && (
          <section className="rounded-lg border border-border">
            <div className="border-b border-border px-3 py-2">
              <h3 className="text-sm font-semibold">What the quotes say meanwhile</h3>
              <p className="text-xs text-muted-foreground">
                A ceiling, not a forecast. Jobs get trimmed and discounted, so what arrives is
                always less than what was quoted.
              </p>
            </div>
            <ul className="divide-y divide-border">
              <Split
                label={`Average of ${quoted.proposals} quotes`}
                value={quoted.averageQuote}
                note={`The middle one is ${money(quoted.medianQuote)}.`}
              />
              <Split
                label="Commission on one of those"
                value={quoted.commissionPerQuote}
                note="If every dollar quoted came in, which it never quite does."
              />
            </ul>
          </section>
        )}
      </div>
    );
  }

  const lumpy = forecast.averageMonthly > forecast.typicalMonthly * 1.5;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 divide-x divide-border rounded-lg border border-border">
        <Figure label="A typical month" value={money(forecast.typicalMonthly)} hint="Middle month" />
        <Figure
          label="An average sale"
          value={money(sales.averageSale)}
          hint={`${money(forecast.perAverageSale)} of commission`}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        {sales.jobsPerMonth} finished jobs a month at {money(sales.salesPerMonth)} collected, over{" "}
        {sales.months} months. The rate works out at {forecast.blendedPct}% of what comes in.
        {lumpy &&
          ` The average month is ${money(forecast.averageMonthly)}, well above the middle one — the months are lumpy, so treat either as a guide rather than a budget.`}
      </p>

      <section className="rounded-lg border border-border">
        <div className="border-b border-border px-3 py-2">
          <h3 className="text-sm font-semibold">What is owed</h3>
          <p className="text-xs text-muted-foreground">
            Dated by when the job finished rather than when a cheque cleared, because that is when
            the business took the obligation on.
          </p>
        </div>
        <ul className="divide-y divide-border">
          <Split
            label="Owed on finished work"
            value={forecast.outstanding}
            note="Earned and not yet handed over. Some of it is held on jobs with something still open."
          />
          <Split
            label="Building up"
            value={forecast.accruing}
            note="Money already in on jobs still running. Not owed yet, and coming."
          />
        </ul>
      </section>

      <section className="rounded-lg border border-border">
        <div className="border-b border-border px-3 py-2">
          <h3 className="text-sm font-semibold">Month by month</h3>
        </div>
        <ul className="divide-y divide-border">
          {[...forecast.months].reverse().map((row) => (
            <li key={row.month} className="flex items-baseline gap-2 px-3 py-2">
              <span className="text-sm font-medium">
                {new Date(`${row.month}-01T12:00:00Z`).toLocaleDateString("en-US", {
                  month: "long",
                  year: "numeric",
                })}
              </span>
              <span className="text-xs text-muted-foreground">
                {row.jobs} job{row.jobs === 1 ? "" : "s"} · {money(row.collected)} in
              </span>
              <span className="ml-auto text-sm font-semibold tabular-nums">
                {money(row.commission)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-xs text-muted-foreground">
        The average sale is the average of money that actually arrived, not of what was quoted. It
        reads lower than the proposals, and the gap is the jobs that were trimmed, discounted, or
        are still half paid.
      </p>
    </div>
  );
}

function Split({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <li className="px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm font-semibold tabular-nums">{money(value)}</span>
      </div>
      <p className="text-[11px] text-muted-foreground">{note}</p>
    </li>
  );
}

function Figure({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="px-3 py-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xl font-bold tabular-nums">{value}</p>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}
