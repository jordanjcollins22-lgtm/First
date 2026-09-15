import { Suspense } from "react";

import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { money } from "@/lib/inventory-value";
import { getTransactionBoard } from "@/lib/data/transactions";
import { anyFilter, filtersFromParams } from "@/lib/transactions";
import { TransactionFilters } from "@/components/money/transaction-filters";
import { TransactionList } from "@/components/money/transaction-list";

/**
 * Everything the banks and cards have sent.
 *
 * Subscriptions answers "what comes back every month" and hides the rest,
 * which is most of it. This is the other half: all of it, newest first, with
 * enough filtering to answer what people actually ask of a statement — what
 * did we spend at Home Depot, what went out in June, what is on the Platinum
 * card, where is the money going.
 *
 * The filters live in the URL rather than in component state, so a view can be
 * reloaded, bookmarked and sent to somebody. Without that, "everything at Home
 * Depot since June" is a conversation that happens by screenshot.
 */
export const dynamic = "force-dynamic";

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("payments", "/more");

  const params = await searchParams;
  const filters = filtersFromParams(params);

  const board = await getTransactionBoard(filters).catch((err) => {
    console.error("Transactions failed to load:", err);
    return null;
  });

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6">
      <header>
        <h1 className="text-xl font-semibold">Transactions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every line the banks and cards have sent, across every account. Search it, narrow it, and
          send somebody the link to what you were looking at.
        </p>
      </header>

      {!board ? (
        <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
          Couldn&apos;t read the transactions just now. Reload the page.
        </p>
      ) : board.everything === 0 ? (
        <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
          Nothing has come through from the banks yet.
        </p>
      ) : (
        <>
          <Suspense fallback={<div className="h-28" />}>
            <TransactionFilters
              filters={filters}
              accounts={board.accounts}
              categories={board.allCategories}
              showing={board.totals.count}
              everything={board.everything}
            />
          </Suspense>

          <div className="grid grid-cols-3 divide-x divide-border rounded-lg border border-border">
            <Figure label="Out" value={money(board.totals.out)} />
            <Figure label="In" value={money(board.totals.in)} />
            <Figure
              label="Net"
              value={`${board.totals.net < 0 ? "−" : "+"}${money(Math.abs(board.totals.net))}`}
            />
          </div>

          {anyFilter(filters) && board.merchants.length > 0 && (
            <section className="rounded-lg border border-border p-3">
              <h2 className="text-sm font-semibold">Where it went</h2>
              <ul className="mt-1.5 flex flex-col gap-1 text-xs">
                {board.merchants.slice(0, 6).map((merchant) => (
                  <li key={merchant.who} className="flex justify-between gap-2">
                    <span className="truncate">
                      {merchant.who}
                      <span className="ml-1.5 text-muted-foreground">× {merchant.count}</span>
                    </span>
                    <span className="shrink-0 tabular-nums">{money(merchant.out)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <TransactionList months={board.months} />
        </>
      )}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-bold tabular-nums sm:text-xl">{value}</p>
    </div>
  );
}
