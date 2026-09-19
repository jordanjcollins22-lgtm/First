import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { getRecurringBoard } from "@/lib/data/recurring";
import { RecurringBoardView } from "@/components/money/recurring-board";

/**
 * Subscriptions.
 *
 * The overhead this business prices against was typed in from memory and is
 * round numbers: rent 2,700, insurance 300, utilities 650. Meanwhile months of
 * real card and bank rows have been sitting in a table nobody reads, and they
 * know the actual answer.
 *
 * So this reads them and says what comes back. Nothing is stored except
 * judgement: whether the fortnightly charge at the bistro is a business
 * expense or lunch, and whether anybody has looked at it yet. The charges
 * themselves are worked out fresh every time, so one cancelled last month
 * drops off by itself -- a saved list would not, and a stale list of
 * subscriptions is worse than none, because it gets trusted.
 */
export const dynamic = "force-dynamic";

export default async function SubscriptionsPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("payments", "/more");

  const board = await getRecurringBoard().catch((err) => {
    console.error("Subscriptions failed to load:", err);
    return null;
  });

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6">
      <header>
        <h1 className="text-xl font-semibold">Subscriptions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything the banks and cards show going out on a rhythm, read from the transactions
          themselves. Tick the ones that are yours, flag the ones to cancel, and push out anything
          that is not an overhead.
        </p>
      </header>

      {board ? (
        board.txnCount === 0 ? (
          <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
            No transactions have come through from the banks yet, so there is nothing to read.
          </p>
        ) : (
          <RecurringBoardView board={board} />
        )
      ) : (
        <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
          Couldn&apos;t read the transactions just now. Reload the page.
        </p>
      )}
    </div>
  );
}
