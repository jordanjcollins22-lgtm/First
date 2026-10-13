import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { loadFinanceDashboard, type FinanceDashboard, type Kpi } from "@/lib/data/finance";
import { loadPayrollWeek, type PayrollWeekView } from "@/lib/data/payroll";
import { listProfiles } from "@/lib/data/team";
import { addDays, mondayOf } from "@/lib/finance/dates";
import { achFeeCents, cardFeeCents } from "@/lib/finance/fees";
import { DIVISION_BAND, type Tone } from "@/lib/finance/metrics";
import { log } from "@/lib/log";
import { AutopayList, FinanceSettingsForm, PayrollCard, QboSyncCard } from "@/components/v2/panels/finance-client";
import { OpenEntity } from "@/components/v2/panels/admin-open";

/**
 * Admin › Finance: the owner's money in one screen. What needs a person
 * first, then revenue, cash and the ratios against the report's planning
 * bands, the weekly scorecard, receivables, and under them the automations
 * (autopay, QuickBooks sync, payroll file) with their switches.
 */
export async function FinancePanel() {
  const organizationId = await getCurrentOrganizationId();
  let data: FinanceDashboard;
  try {
    data = await loadFinanceDashboard(organizationId);
  } catch (err) {
    log.error("finance.panel.failed", err);
    return (
      <section className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
        Finance couldn&apos;t load. If migration 0363 hasn&apos;t been applied yet, that is why; everything else in the app is unaffected.
      </section>
    );
  }
  const lastWeek = addDays(mondayOf(data.today), -7);
  const [payroll, profiles] = await Promise.all([
    loadPayrollWeek(organizationId, lastWeek).catch(() => null as PayrollWeekView | null),
    listProfiles().catch(() => []),
  ]);
  const people = profiles
    .filter((p) => p.organization_id === organizationId)
    .map((p) => ({ id: p.id, name: p.full_name || p.email, payrollId: data.settings.payrollIds[p.id] ?? "" }));

  return (
    <section className="space-y-6" aria-labelledby="finance-heading">
      <header className="space-y-1">
        <h2 id="finance-heading" className="text-xl font-bold">
          Finance
        </h2>
        <p className="text-sm text-muted-foreground">Targets are planning bands from the playbook (mostly vendor sources), not industry standards. Green is on target, yellow is close, red needs a look.</p>
      </header>

      {/* Needs you */}
      {data.needsYou.length > 0 && (
        <ul className="space-y-2" aria-label="Needs you">
          {data.needsYou.map((n) => (
            <li
              key={n.key}
              className={
                n.tone === "bad"
                  ? "rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100"
                  : "rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
              }
            >
              {n.text}
            </li>
          ))}
        </ul>
      )}

      {/* Revenue and cash */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(["week", "month", "ytd"] as const).map((p) => (
          <div key={p} className="rounded-xl border bg-card p-3">
            <div className="text-xs text-muted-foreground">{p === "week" ? "This week" : p === "month" ? "This month" : "Year to date"}</div>
            <div className="font-mono text-2xl">{usd(data.revenue[p].collected)}</div>
            <div className="text-xs text-muted-foreground">collected · {usd(data.revenue[p].invoiced)} invoiced</div>
          </div>
        ))}
        <div className="rounded-xl border bg-card p-3">
          <div className="text-xs text-muted-foreground">Cash in bank</div>
          {data.cash.connected ? (
            <>
              <div className="font-mono text-2xl">{usd(data.cash.balance ?? 0)}</div>
              <div className="text-xs text-muted-foreground">
                {data.cash.accounts} account{data.cash.accounts === 1 ? "" : "s"}
                {data.cash.asOf ? ` · ${new Date(data.cash.asOf).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
                {!data.cash.live && " · sandbox, not your real bank"}
              </div>
            </>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">Not connected — link the bank (Plaid) under Finance › Transactions.</p>
          )}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {[data.ratios.marketing, data.ratios.labor, data.ratios.net].map((k) => (
          <RatioCard key={k.label} k={k} />
        ))}
      </div>

      {/* Gross margin by division */}
      <div className="space-y-2">
        <h3 className="font-semibold">Gross margin by division</h3>
        {data.costedJobs === 0 ? (
          <p className="rounded-xl border bg-card p-3 text-sm text-muted-foreground">
            No finished jobs have final crew hours and an invoice yet, so there is nothing to cost. This fills in as job close-out records hours (job costing is being built).
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            {data.margins.map((m) => (
              <div key={m.division} className={`rounded-xl border bg-card p-3 ${ring(m.tone)}`}>
                <div className="text-xs text-muted-foreground">{m.division}</div>
                <div className="font-mono text-2xl">{m.marginPct === null ? "—" : `${m.marginPct}%`}</div>
                <div className="text-xs text-muted-foreground">
                  target {DIVISION_BAND[m.division].label} · {m.jobs} job{m.jobs === 1 ? "" : "s"}, {usd(m.revenue)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Weekly scorecard */}
      <div className="space-y-2">
        <h3 className="font-semibold">Weekly scorecard</h3>
        <p className="text-sm text-muted-foreground">Fifteen minutes on Monday: scan, note wins, find the cause of each red, give each fix one owner and a date.</p>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[36rem] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-2 font-medium">Metric</th>
                <th className="p-2 font-medium">Now</th>
                <th className="p-2 font-medium">Target</th>
                <th className="p-2 font-medium">Owner</th>
              </tr>
            </thead>
            <tbody>
              {data.scorecard.map((m) => (
                <tr key={m.key} className="border-t">
                  <td className="p-2">
                    <span className="flex items-center gap-2">
                      <Dot tone={m.tone} />
                      {m.label}
                    </span>
                    {m.note && <span className="block pl-4 text-xs text-muted-foreground">{m.note}</span>}
                  </td>
                  <td className="p-2 font-mono">{m.value}</td>
                  <td className="p-2 text-muted-foreground">{m.target}</td>
                  <td className="p-2">{m.owner}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* AR aging */}
      <div className="space-y-2">
        <h3 className="font-semibold">Receivables</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
          <div className="rounded-xl border bg-card p-3">
            <div className="text-xs text-muted-foreground">Owed</div>
            <div className="font-mono text-lg">{usd(data.aging.total)}</div>
          </div>
          {data.aging.buckets.map((b) => (
            <div key={b.key} className={`rounded-xl border bg-card p-3 ${b.key === "current" ? "" : b.amount > 0 ? (b.key === "1-30" ? ring("warn") : ring("bad")) : ""}`}>
              <div className="text-xs text-muted-foreground">{b.label}</div>
              <div className="font-mono text-lg">{usd(b.amount)}</div>
              <div className="text-xs text-muted-foreground">{b.count} invoice{b.count === 1 ? "" : "s"}</div>
            </div>
          ))}
        </div>
        <p className="text-sm">
          DSO <b className="font-mono">{data.dso === null ? "—" : `${data.dso} days`}</b> against a target of under {data.settings.dsoTargetDays} days.
          {data.settings.lateFeeEnabled && data.aging.lateFees > 0 && <> Late fees that would apply now: <b className="font-mono">{usd(data.aging.lateFees)}</b>.</>}
        </p>
        {data.aging.rows.some((r) => r.daysLate > 0) && (
          <ul className="divide-y rounded-xl border bg-card text-sm">
            {data.aging.rows
              .filter((r) => r.daysLate > 0)
              .slice(0, 10)
              .map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                  <OpenEntity kind="admin.invoice" id={r.id} className="min-h-11 min-w-0 flex-1 font-medium">
                    {r.customerName}
                  </OpenEntity>
                  <span className="font-mono">{usd(r.amount)}</span>
                  <span className="text-muted-foreground">{r.daysLate} days late</span>
                  {r.hostedUrl && (
                    <a href={r.hostedUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline">
                      Invoice
                    </a>
                  )}
                </li>
              ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">Reminders before and after the due date are sent by the invoice reminder automation (Sales › Automated messages).</p>
      </div>

      {/* Automations and settings */}
      <div className="space-y-3">
        <h3 className="font-semibold">Invoicing &amp; collections</h3>
        <FinanceSettingsForm
          settings={{
            offerAch: data.settings.offerAch,
            autopayEnabled: data.settings.autopayEnabled,
            autopayStartedAt: data.settings.autopayStartedAt,
            lateFeeEnabled: data.settings.lateFeeEnabled,
            lateFeeStartedAt: data.settings.lateFeeStartedAt,
            lateFeeKind: data.settings.lateFeeKind,
            lateFeeAmount: data.settings.lateFeeAmount,
            lateFeeGraceDays: data.settings.lateFeeGraceDays,
            dsoTargetDays: data.settings.dsoTargetDays,
            ready: data.settings.ready,
          }}
          feeExample={{ ach: achFeeCents(200_000), card: cardFeeCents(200_000) }}
        />
        <AutopayList clients={data.autopay} autopayOn={data.settings.autopayEnabled} />
      </div>

      <QboSyncCard
        status={{
          connected: data.qbo.connected,
          enabled: data.qbo.enabled,
          startedAt: data.settings.qboSyncStartedAt,
          from: data.settings.qboSyncFrom,
          lastRun: data.qbo.lastRun,
          mapped: data.qbo.mapped,
          errors: data.qbo.errors,
        }}
      />

      <PayrollCard initial={payroll} people={people} />
    </section>
  );
}

function usd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function ring(tone: Tone): string {
  return tone === "good"
    ? "border-emerald-300 dark:border-emerald-800"
    : tone === "warn"
      ? "border-amber-300 dark:border-amber-800"
      : tone === "bad"
        ? "border-red-300 dark:border-red-800"
        : "";
}

function Dot({ tone }: { tone: Tone }) {
  const cls = tone === "good" ? "bg-emerald-500" : tone === "warn" ? "bg-amber-500" : tone === "bad" ? "bg-red-500" : "bg-muted-foreground/40";
  const label = tone === "good" ? "on target" : tone === "warn" ? "close" : tone === "bad" ? "off target" : "no data";
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${cls}`} role="img" aria-label={label} />;
}

function RatioCard({ k }: { k: Kpi }) {
  return (
    <div className={`rounded-xl border bg-card p-3 ${ring(k.tone)}`}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Dot tone={k.tone} />
        {k.label}
      </div>
      <div className="font-mono text-2xl">{k.value === null ? "—" : `${k.value}%`}</div>
      <div className="text-xs text-muted-foreground">target {k.target}</div>
      {k.note && <p className="mt-1 text-xs text-muted-foreground">{k.note}</p>}
    </div>
  );
}
