import Link from "next/link";

import { YearSettingsForm } from "@/components/accounting/year-settings-form";
import { AccountingNav, YearPicker } from "@/components/accounting/year-picker";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { money } from "@/lib/accounting/format";
import {
  auditChecks,
  buildScheduleC,
  comparePlantTreatments,
  type AuditFlag,
  type LineTotal,
  type TreatmentScenario,
} from "@/lib/accounting/report";
import { getYearSettings, listYearTransactions, parseYear } from "@/lib/data/accounting";
import { isSupabaseConfigured } from "@/lib/env";

export default async function ScheduleCPage({ searchParams }: PageProps<"/accounting/schedule-c">) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const year = parseYear((await searchParams).year);

  const [transactions, settings] = await Promise.all([listYearTransactions(year), getYearSettings(year)]);
  const decision = comparePlantTreatments(transactions, settings);
  const treatment = settings.plantTreatment ?? decision.recommended;
  const report = buildScheduleC(transactions, settings, treatment);
  const flags = auditChecks(transactions, report, { ...settings, plantTreatment: treatment });
  const txById = new Map(transactions.map((t) => [t.id, t]));

  const byId = new Map(report.lines.map((l) => [l.id, l]));
  const amt = (id: LineTotal["id"]) => byId.get(id)?.amount ?? 0;
  const line28 = report.totalExpenses - amt("30");
  const line29 = report.grossIncome - line28;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Schedule C · {year}</h1>
          <p className="text-muted-foreground">Profit or Loss From Business (Form 1040), built from your categorized transactions.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href={`/accounting/schedule-c/export?year=${year}`}>Download CSV for your CPA</a>
          </Button>
          <YearPicker year={year} basePath="/accounting/schedule-c" />
        </div>
      </div>
      <AccountingNav year={year} active="schedule-c" />

      {transactions.length === 0 && (
        <p className="mb-6 rounded-md border border-border bg-muted/50 px-4 py-3 text-sm">
          No transactions for {year} yet. <Link href={`/accounting?year=${year}`} className="text-primary underline">Import a statement</Link> to get started.
        </p>
      )}

      {/* Plants: sell vs install */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Plants: sell them or install them?</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <p className="text-muted-foreground">
            {money(decision.materialsSpend, { cents: false })} of plants and materials this year
            {settings.salesTaxPaidOnMaterials && decision.materialsSpend > 0
              ? ` (${money(decision.materialsCostBeforeTax, { cents: false })} before sales tax)`
              : ""}
            . Selling puts them in cost of goods sold (Part III). Installing puts them in supplies (line 22). Federal profit
            is the same either way once year-end inventory is counted; the difference is who pays sales tax.
          </p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <ScenarioCard scenario={decision.scenarios.install} title="Install (materials in a service)" recommended={decision.recommended === "install"} active={treatment === "install"} />
            <ScenarioCard scenario={decision.scenarios.sell} title="Sell (retail plants, COGS)" recommended={decision.recommended === "sell"} active={treatment === "sell"} />
          </div>
          <p className="font-medium">{decision.explanation}</p>
          <div>
            <p className="mb-1 font-medium">
              To use &quot;{treatment === "sell" ? "sell" : "install"}&quot; without audit trouble:
            </p>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              {decision.scenarios[treatment].requirements.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
          {settings.plantTreatment && settings.plantTreatment !== decision.recommended && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
              You locked in &quot;{settings.plantTreatment}&quot;, but &quot;{decision.recommended}&quot; currently comes out lower. Only
              switch if you can change invoicing and sales tax handling to match (best at the start of a year).
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Year-end inputs</CardTitle>
        </CardHeader>
        <CardContent>
          <YearSettingsForm settings={settings} recommended={decision.recommended} />
        </CardContent>
      </Card>

      {/* Audit risk */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Audit-risk check</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {flags.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing flagged.</p>
          ) : (
            flags.map((flag) => <FlagRow key={flag.title} flag={flag} year={year} txById={txById} />)
          )}
          <p className="text-xs text-muted-foreground">
            Heuristics based on IRS documentation rules and common audit triggers, not the IRS&apos;s own scoring. Keep receipts for
            everything; for meals, travel and vehicles also write down the business purpose.
          </p>
        </CardContent>
      </Card>

      {/* The form */}
      <Card>
        <CardHeader>
          <CardTitle>Line by line</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <Part title="Part I · Income">
            <LineRow line={byId.get("1")!} />
            <LineRow line={byId.get("2")!} />
            <Subtotal label="3 · Subtract line 2 from line 1" amount={report.grossReceipts - report.returns} />
            <LineRow line={byId.get("4")!} />
            <Subtotal label="5 · Gross profit" amount={report.grossProfit} />
            <LineRow line={byId.get("6")!} />
            <Subtotal label="7 · Gross income" amount={report.grossIncome} strong />
          </Part>

          <Part title="Part II · Expenses">
            {report.lines.filter((l) => l.part === "II" && l.id !== "30").map((l) => (
              <LineRow key={l.id} line={l} />
            ))}
            <Subtotal label="28 · Total expenses" amount={line28} strong />
            <Subtotal label="29 · Tentative profit" amount={line29} />
            <LineRow line={byId.get("30")!} />
            <Subtotal label="31 · Net profit or (loss)" amount={report.netProfit} strong />
          </Part>

          <Part title={`Part III · Cost of Goods Sold${treatment === "install" ? " (not used: plants are on line 22)" : ""}`}>
            {(["35", "36", "37", "38", "39"] as const).map((id) => (
              <LineRow key={id} line={byId.get(id)!} />
            ))}
            <Subtotal label="40 · Add lines 35 through 39" amount={amt("35") + amt("36") + amt("37") + amt("38") + amt("39")} />
            <LineRow line={byId.get("41")!} />
            <Subtotal label="42 · Cost of goods sold (to line 4)" amount={report.costOfGoodsSold} strong />
          </Part>
        </CardContent>
      </Card>

      <p className="mt-6 text-xs text-muted-foreground">
        This organizes your books for Schedule C and estimates tax at the rates you entered. It isn&apos;t tax advice or a filed
        return; have a CPA or EA review it, especially the plant treatment, depreciation (Form 4562) and vehicle method.
      </p>
    </div>
  );
}

function ScenarioCard({ scenario, title, recommended, active }: { scenario: TreatmentScenario; title: string; recommended: boolean; active: boolean }) {
  const rows: [string, number][] = [
    ["Net profit", scenario.netProfit],
    ["Self-employment tax", scenario.taxes.selfEmploymentTax],
    ["Federal income tax (est.)", scenario.taxes.federalIncomeTax],
    ["State income tax (est.)", scenario.taxes.stateIncomeTax],
    ["Sales/use tax you pay on materials", scenario.salesTaxBorneByBusiness],
  ];
  return (
    <div className={`rounded-lg border p-4 ${recommended ? "border-primary" : "border-border"}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className="font-semibold">{title}</p>
        {recommended && <Badge>Lower tax</Badge>}
        {active && <Badge variant="outline">Used below</Badge>}
      </div>
      <dl className="space-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="tabular-nums">{money(value, { cents: false })}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-2 border-t border-border pt-1 font-semibold">
          <dt>Taxes the business pays</dt>
          <dd className="tabular-nums">{money(scenario.businessTaxTotal, { cents: false })}</dd>
        </div>
        <div className="flex justify-between gap-2 text-xs text-muted-foreground">
          <dt>Sales tax added to customer invoices</dt>
          <dd className="tabular-nums">{money(scenario.salesTaxChargedToCustomers, { cents: false })}</dd>
        </div>
      </dl>
    </div>
  );
}

function Part({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="divide-y divide-border rounded-md border border-border">{children}</div>
    </section>
  );
}

function LineRow({ line }: { line: LineTotal }) {
  const empty = line.amount === 0;
  return (
    <details className={`group px-3 py-2 ${empty ? "text-muted-foreground" : ""}`}>
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
        <span>
          <span className="mr-2 inline-block w-8 font-mono text-xs">{line.id}</span>
          <span className={empty ? "" : "font-medium"}>{line.label}</span>
        </span>
        <span className="tabular-nums">{money(line.amount)}</span>
      </summary>
      <div className="mt-2 pl-10 text-xs">
        <p className="text-muted-foreground">{line.description}</p>
        {line.sources.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {line.sources.map((s) => (
              <li key={s.category} className="flex justify-between gap-2">
                <span>
                  {s.label}
                  {s.count ? ` (${s.count})` : " (inventory adjustment)"}
                </span>
                <span className="tabular-nums">{money(s.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

function Subtotal({ label, amount, strong }: { label: string; amount: number; strong?: boolean }) {
  return (
    <div className={`flex justify-between bg-muted/40 px-3 py-2 text-sm ${strong ? "font-semibold" : ""}`}>
      <span className="pl-10">{label}</span>
      <span className="tabular-nums">{money(amount)}</span>
    </div>
  );
}

function FlagRow({ flag, year, txById }: { flag: AuditFlag; year: number; txById: Map<string, { description: string; amount: number; posted_on: string }> }) {
  const tone =
    flag.level === "high"
      ? "border-red-300 bg-red-50 text-red-900"
      : flag.level === "medium"
        ? "border-amber-300 bg-amber-50 text-amber-900"
        : "border-border bg-muted/40";
  const examples = (flag.transactionIds ?? []).slice(0, 5).map((id) => txById.get(id)).filter(Boolean);
  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${tone}`}>
      <p className="font-semibold">{flag.title}</p>
      <p>{flag.detail}</p>
      {examples.length > 0 && (
        <ul className="mt-1 text-xs opacity-80">
          {examples.map((t) => (
            <li key={`${t!.posted_on}${t!.description}${t!.amount}`}>
              {t!.posted_on} · {t!.description} · {money(t!.amount)}
            </li>
          ))}
          {(flag.transactionIds?.length ?? 0) > 5 && (
            <li>
              …and {flag.transactionIds!.length - 5} more ·{" "}
              <Link className="underline" href={`/accounting/transactions?year=${year}&view=all`}>
                open transactions
              </Link>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
