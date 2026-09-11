import Link from "next/link";

import { money } from "@/lib/inventory-value";
import type { OverheadBreakdown } from "@/lib/overhead";

/**
 * What the business costs to keep open.
 *
 * Nothing here is typed in. It used to be five round numbers somebody entered
 * from memory — rent 2,700, insurance 300, utilities 650 — which were close,
 * and close is the problem: nobody could tell which of the five was wrong or
 * by how much, and every one of them was already in the transactions.
 *
 * Derived means it moves on its own. The rent goes up in March and the number
 * the quotes are built on goes up in March.
 */
export function OverheadPanel({ overhead }: { overhead: OverheadBreakdown }) {
  if (overhead.groups.length === 0) {
    return (
      <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
        Nothing recurring has been found in the transactions yet, so there is no overhead to show.
        Once the banks have sent a few months it works itself out.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 divide-x divide-border rounded-lg border border-border">
        <Figure label="Every month" value={money(overhead.monthly)} />
        <Figure label="Every year" value={money(overhead.yearly)} />
      </div>

      <p className="text-xs text-muted-foreground">
        Worked out from the bank, not typed in.
        {overhead.variableShare > 0.2 &&
          ` About ${Math.round(overhead.variableShare * 100)}% of it is an average of bills that move, so treat it as a guide rather than a fixed figure.`}{" "}
        <Link href="/admin/subscriptions" className="underline">
          Sort the charges
        </Link>{" "}
        to sharpen it.
      </p>

      <ul className="divide-y divide-border rounded-lg border border-border">
        {overhead.groups.map((group) => (
          <li key={group.group} className="px-3 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium">{group.label}</span>
              <span className="text-sm font-semibold tabular-nums">{money(group.monthly)}</span>
            </div>
            <ul className="mt-1 flex flex-col gap-0.5">
              {group.lines.map((line) => (
                <li key={line.key} className="flex justify-between gap-2 text-xs text-muted-foreground">
                  <span className="truncate">
                    {line.label}
                    {line.variable && <span className="ml-1.5">(varies)</span>}
                  </span>
                  <span className="shrink-0 tabular-nums">{money(line.monthly)}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xl font-bold tabular-nums">{value}</p>
    </div>
  );
}
