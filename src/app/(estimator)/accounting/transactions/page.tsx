import Link from "next/link";

import { CategoryOptions, SELECT_CLASS } from "@/components/accounting/category-select";
import { TransactionTable } from "@/components/accounting/transaction-table";
import { AccountingNav, YearPicker } from "@/components/accounting/year-picker";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isCategoryKey } from "@/lib/accounting/schedule-c";
import { countNeedsReview, listRules, listTransactions, parseYear } from "@/lib/data/accounting";
import { isSupabaseConfigured, serverEnv } from "@/lib/env";
import { cn } from "@/lib/utils";

import { RuleList } from "./rule-list";

export default async function TransactionsPage({ searchParams }: PageProps<"/accounting/transactions">) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const params = await searchParams;
  const year = parseYear(params.year);
  const needsReview = await countNeedsReview(year);
  const view = params.view === "all" || (params.view !== "review" && needsReview === 0) ? "all" : "review";
  const rawCategory = typeof params.category === "string" ? params.category : "";
  const category = isCategoryKey(rawCategory) ? rawCategory : undefined;
  const q = typeof params.q === "string" ? params.q.trim() : "";

  const [transactions, rules] = await Promise.all([
    listTransactions({ year, view, category, q: q || undefined }),
    listRules(),
  ]);

  const qs = (v: string) => `&view=${v}${category ? `&category=${category}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Transactions</h1>
          <p className="text-muted-foreground">
            Confirm each category. Nothing marked &quot;Needs review&quot; counts toward the return.
          </p>
        </div>
        <YearPicker year={year} basePath="/accounting/transactions" extra={qs(view)} />
      </div>
      <AccountingNav year={year} active="transactions" />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex gap-1 rounded-md border border-border bg-card p-1 text-sm">
          <Link
            href={`/accounting/transactions?year=${year}${qs("review")}`}
            className={cn("rounded px-3 py-1", view === "review" ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
          >
            Needs review ({needsReview})
          </Link>
          <Link
            href={`/accounting/transactions?year=${year}${qs("all")}`}
            className={cn("rounded px-3 py-1", view === "all" ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
          >
            All
          </Link>
        </div>
        <form className="flex flex-wrap items-end gap-2" action="/accounting/transactions">
          <input type="hidden" name="year" value={year} />
          <input type="hidden" name="view" value={view} />
          <select name="category" defaultValue={category ?? ""} className={cn(SELECT_CLASS, "w-64")}>
            <option value="">All categories</option>
            <CategoryOptions />
          </select>
          <Input name="q" defaultValue={q} placeholder="Search description" className="w-56" />
          <Button type="submit" variant="outline" size="sm">
            Filter
          </Button>
        </form>
      </div>

      <TransactionTable
        transactions={transactions}
        year={year}
        aiEnabled={Boolean(serverEnv.anthropicApiKey) && view === "review"}
      />
      {transactions.length === 500 && (
        <p className="mt-2 text-xs text-muted-foreground">Showing the 500 most recent. Filter to see more.</p>
      )}

      {rules.length > 0 && (
        <div className="mt-10">
          <h2 className="mb-2 text-lg font-semibold">Your merchant rules</h2>
          <RuleList rules={rules} />
        </div>
      )}
    </div>
  );
}
