import { Repeat } from "lucide-react";

import { cn } from "@/lib/utils";
import { money } from "@/lib/inventory-value";
import { categoryLabel, type MonthGroup, type Transaction } from "@/lib/transactions";

/**
 * The statement itself.
 *
 * Broken into months because a list with no months in it is a wall, and the
 * subtotal per month is what somebody scans for before reading a single line.
 * Money in and money out are shown apart rather than as one signed column: a
 * minus sign is easy to miss and expensive to miss.
 */
export function TransactionList({ months }: { months: MonthGroup[] }) {
  if (months.length === 0) {
    return (
      <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
        Nothing matches. Widen the search, or show everything.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {months.map((group) => (
        <section key={group.month} className="rounded-lg border border-border">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border px-3 py-2">
            <h2 className="text-sm font-semibold">{group.label}</h2>
            <p className="text-xs text-muted-foreground">
              {money(group.totals.out)} out
              {group.totals.in > 0 && `, ${money(group.totals.in)} in`}
              {` · ${group.totals.count} transaction${group.totals.count === 1 ? "" : "s"}`}
            </p>
          </div>
          <ul className="divide-y divide-border">
            {group.txns.map((txn) => (
              <Row key={txn.id} txn={txn} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Row({ txn }: { txn: Transaction }) {
  const incoming = txn.amount < 0;

  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3 py-2">
      <span className="w-12 shrink-0 text-xs tabular-nums text-muted-foreground">
        {new Date(`${txn.postedOn}T12:00:00Z`).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        })}
      </span>

      <span className="min-w-0 flex-1 text-sm">
        {txn.who}
        {txn.recurring && (
          <span
            className="ml-1.5 inline-flex items-center gap-0.5 align-middle text-[11px] text-muted-foreground"
            title="Comes back on a rhythm"
          >
            <Repeat className="h-3 w-3" />
            monthly
          </span>
        )}
        {txn.pending && <span className="ml-1.5 text-[11px] text-muted-foreground">pending</span>}
      </span>

      <span
        className={cn(
          "shrink-0 text-sm font-medium tabular-nums",
          incoming && "text-primary"
        )}
      >
        {incoming ? "+" : ""}
        {money(Math.abs(txn.amount))}
      </span>

      <span className="w-full text-[11px] text-muted-foreground">
        {[txn.accountName, categoryLabel(txn.category)].filter(Boolean).join(" · ")}
      </span>
    </li>
  );
}
