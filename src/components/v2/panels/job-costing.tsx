import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { loadJobCosting } from "@/lib/data/ops-panels";
import { money, hours } from "@/lib/ops/kpis";
import { RecomputeButton } from "@/components/v2/panels/ops-autopilot-client";
import { NotReady, SectionTitle, shortDate } from "@/components/v2/panels/ops-shared";
import { OpenButton, OpenEntity } from "@/components/v2/panels/admin-open";

/**
 * Admin › Finance: what each finished job really cost.
 *
 * Every row is a snapshot the completion chain took from the crew's own taps
 * (left shop, arrived, finished), each person's pay rate, receipts and the
 * accepted price. Jobs over their hours are first; completed jobs that never
 * got a snapshot (finished before the chain went live) are listed after.
 */
export async function JobCostingPanel() {
  const organizationId = await getCurrentOrganizationId();
  const data = await loadJobCosting(organizationId);
  if (!data.ready) return <NotReady />;

  const over = data.rows.filter((r) => r.overBudget);
  const margin = data.totals.revenueCents > 0 ? Math.round((data.totals.marginCents / data.totals.revenueCents) * 100) : null;

  return (
    <section className="grid gap-6">
      <div className="grid gap-3">
        <SectionTitle sub="Jobs more than the threshold over their budgeted hours.">Needs you</SectionTitle>
        {over.length === 0 ? (
          <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">No costed job is over its hours.</p>
        ) : (
          <ul className="grid gap-2">
            {over.map((r) => (
              <li key={r.jobId} className="flex flex-wrap items-center gap-3 rounded-xl border border-orange-300 bg-card p-3 dark:border-orange-800">
                <span className="min-w-0 flex-1">
                  <span className="font-semibold">{r.name}</span>
                  <span className="block text-sm text-muted-foreground">
                    {hours(r.actualHours)} worked against {hours(r.budgetHours)} budgeted ({Math.round(r.hoursVariancePct ?? 0)}% over).
                  </span>
                </span>
                <OpenButton kind="admin.job" id={r.jobId} label="Open job" />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Revenue (costed jobs)", value: money(data.totals.revenueCents) },
          { label: "Labour", value: money(data.totals.laborCents) },
          { label: "Materials", value: money(data.totals.materialsCents) },
          { label: "Gross margin", value: `${money(data.totals.marginCents)}${margin == null ? "" : ` · ${margin}%`}` },
        ].map((t) => (
          <div key={t.label} className="rounded-xl border bg-card p-4">
            <p className="text-sm text-muted-foreground">{t.label}</p>
            <p className="mt-1 font-mono text-2xl">{t.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-3">
        <SectionTitle sub={`${data.rows.length} jobs, ${hours(data.totals.hours)} of crew time. Budget is the estimate the client accepted.`}>Job costs</SectionTitle>
        {data.rows.length === 0 ? (
          <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">No job has been costed yet. The first one comes when a work day closes after go-live.</p>
        ) : (
          <ul className="grid gap-2">
            {data.rows.map((r) => (
              <li key={r.jobId} className="grid gap-2 rounded-xl border bg-card p-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <OpenEntity kind="admin.job" id={r.jobId} className="min-w-0 flex-1 font-semibold">
                    {r.name}
                  </OpenEntity>
                  <span className="text-xs text-muted-foreground">
                    {r.final ? "Final" : "Provisional"} · {shortDate(r.computedAt)}
                  </span>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-5">
                  <div>
                    <dt className="text-muted-foreground">Hours</dt>
                    <dd className={`font-mono ${r.overBudget ? "text-red-700 dark:text-red-300" : ""}`}>
                      {hours(r.actualHours)} / {hours(r.budgetHours)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Price</dt>
                    <dd className="font-mono">{money(r.revenueCents)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Labour</dt>
                    <dd className="font-mono">{money(r.laborCents)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Materials</dt>
                    <dd className="font-mono">{money(r.materialsCents)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Margin</dt>
                    <dd className="font-mono">
                      {money(r.grossMarginCents)}
                      {r.grossMarginPct == null ? "" : ` · ${Math.round(r.grossMarginPct)}%`}
                    </dd>
                  </div>
                </dl>
                {r.notes.length > 0 && <p className="text-xs text-muted-foreground">{r.notes.join(" ")}</p>}
                <div>
                  <RecomputeButton jobId={r.jobId} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {data.uncosted.length > 0 && (
        <div className="grid gap-2">
          <SectionTitle sub="Completed before the costing went live, so no snapshot exists. Recalculate one to cost it from whatever taps and clock entries it has.">
            Completed, not costed ({data.uncosted.length})
          </SectionTitle>
          <ul className="grid gap-1.5">
            {data.uncosted.slice(0, 20).map((j) => (
              <li key={j.jobId} className="flex flex-wrap items-center gap-3 rounded-lg bg-muted px-3 py-2 text-sm">
                <OpenEntity kind="admin.job" id={j.jobId} className="min-w-0 flex-1">
                  {j.name}
                </OpenEntity>
                <RecomputeButton jobId={j.jobId} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
