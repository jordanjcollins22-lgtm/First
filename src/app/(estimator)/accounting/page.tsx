import Link from "next/link";

import { ImportCsvForm } from "@/components/accounting/import-csv-form";
import { ConnectionActions, PlaidConnectButton } from "@/components/accounting/plaid-connect";
import { AccountingNav, YearPicker } from "@/components/accounting/year-picker";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { money } from "@/lib/accounting/format";
import { buildScheduleC, comparePlantTreatments } from "@/lib/accounting/report";
import {
  countNeedsReview,
  getYearSettings,
  listAccounts,
  listConnections,
  listYearTransactions,
  parseYear,
} from "@/lib/data/accounting";
import { isPlaidConfigured, isSupabaseConfigured } from "@/lib/env";

export default async function AccountingPage({ searchParams }: PageProps<"/accounting">) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const year = parseYear((await searchParams).year);

  const [accounts, connections, transactions, settings, needsReview] = await Promise.all([
    listAccounts(),
    listConnections(),
    listYearTransactions(year),
    getYearSettings(year),
    countNeedsReview(year),
  ]);
  const decision = comparePlantTreatments(transactions, settings);
  const report = buildScheduleC(transactions, settings, settings.plantTreatment ?? decision.recommended);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Books</h1>
          <p className="text-muted-foreground">Bank activity sorted into Schedule C lines.</p>
        </div>
        <YearPicker year={year} basePath="/accounting" />
      </div>
      <AccountingNav year={year} active="overview" />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Gross receipts (line 1)" value={money(report.grossReceipts, { cents: false })} />
        <Stat label="Expenses + COGS" value={money(report.totalExpenses + report.costOfGoodsSold, { cents: false })} />
        <Stat label="Net profit (line 31)" value={money(report.netProfit, { cents: false })} />
        <Stat
          label="Need review"
          value={String(needsReview)}
          tone={needsReview > 0 ? "warn" : "ok"}
          href={`/accounting/transactions?year=${year}`}
        />
      </div>

      {transactions.length > 0 && (
        <Card className="mb-6">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6 text-sm">
            <p>
              {transactions.length} transactions in {year}.{" "}
              {needsReview > 0
                ? `${needsReview} still need a decision before the numbers are final.`
                : "Everything is categorized."}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link href={`/accounting/transactions?year=${year}`}>Review transactions</Link>
              </Button>
              <Button size="sm" asChild>
                <Link href={`/accounting/schedule-c?year=${year}`}>Open Schedule C</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Upload a bank statement</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Download the CSV export from your bank or card site (usually under Statements or Activity →
              Download). Re-uploading overlapping dates is safe; duplicates are skipped.
            </p>
            <ImportCsvForm accounts={accounts.filter((a) => a.source === "csv")} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Automatic bank feed</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {isPlaidConfigured() ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Link a bank or card through Plaid. New transactions are pulled every morning, or press Sync now.
                </p>
                <PlaidConnectButton />
              </>
            ) : (
              <p className="rounded-md border border-border bg-muted/50 px-4 py-3 text-sm">
                Not set up yet. Add <code>PLAID_CLIENT_ID</code>, <code>PLAID_SECRET</code> and{" "}
                <code>SUPABASE_SERVICE_ROLE_KEY</code> to turn on automatic pulls. CSV upload works without it.
              </p>
            )}

            {connections.length > 0 && (
              <ul className="divide-y divide-border rounded-md border border-border">
                {connections.map((c) => (
                  <li key={c.id} className="flex items-start justify-between gap-3 px-3 py-3 text-sm">
                    <div>
                      <p className="font-medium">{c.institution_name ?? "Bank"}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.last_synced_at ? `Last synced ${new Date(c.last_synced_at).toLocaleString()}` : "Not synced yet"}
                      </p>
                      {c.status === "error" && c.last_error && (
                        <p className="text-xs text-destructive">{c.last_error}</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {accounts
                          .filter((a) => a.connection_id === c.id)
                          .map((a) => `${a.name}${a.mask ? ` ••${a.mask}` : ""}`)
                          .join(", ")}
                      </p>
                    </div>
                    <ConnectionActions connectionId={c.id} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, tone, href }: { label: string; value: string; tone?: "warn" | "ok"; href?: string }) {
  const body = (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${tone === "warn" ? "text-amber-700" : ""}`}>{value}</p>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
