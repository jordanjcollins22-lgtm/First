"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle } from "lucide-react";

import {
  byCredit,
  byOwed,
  neverBilled,
  reconcileLine,
  type Reconciliation,
} from "@/lib/accounting-reconcile";

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

type View = "owed" | "credit" | "unbilled";

/**
 * Billed against banked.
 *
 * Three lists, and each one is a different job. Owed is who to ring. Taken
 * with no invoice is either work billed somewhere else or a payment on the
 * wrong contact. Never billed is the back catalogue — people who paid us
 * before any of this existed, and the list a proposal still has to be written
 * for.
 */
export function MoneyPanel({ result }: { result: Reconciliation }) {
  const [view, setView] = useState<View>("owed");

  const owed = useMemo(() => byOwed(result.balances), [result.balances]);
  const credit = useMemo(() => byCredit(result.balances), [result.balances]);
  const unbilled = useMemo(() => neverBilled(result.balances), [result.balances]);

  const shown = view === "owed" ? owed : view === "credit" ? credit : unbilled;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <Tile label="Billed" value={money(result.billedCents)} />
        <Tile label="Received" value={money(result.receivedCents)} />
        <Tile
          label="Still owed"
          value={money(result.owedCents)}
          tone={result.owedCents > 0 ? "warn" : undefined}
        />
        <Tile label="No invoice behind it" value={money(result.creditCents)} />
      </div>

      <p className="text-sm text-muted-foreground">{reconcileLine(result)}</p>

      {result.unattributedCents > 0 && (
        <p className="flex items-start gap-1.5 rounded-lg border border-amber-300/70 bg-amber-50/70 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
          {money(result.unattributedCents)} is recorded against nobody, so it is in neither total
          above. Match it up on Money → Received.
        </p>
      )}

      <div className="flex flex-wrap gap-1.5">
        <FilterButton active={view === "owed"} onClick={() => setView("owed")}>
          Owed ({owed.length})
        </FilterButton>
        <FilterButton active={view === "credit"} onClick={() => setView("credit")}>
          Paid beyond the bill ({credit.length})
        </FilterButton>
        <FilterButton active={view === "unbilled"} onClick={() => setView("unbilled")}>
          Never billed here ({unbilled.length})
        </FilterButton>
      </div>

      <p className="text-xs text-muted-foreground">
        {view === "owed"
          ? "Billed more than they have paid. Biggest gap first."
          : view === "credit"
            ? "Paid more than we billed them here — usually work invoiced somewhere else, sometimes a payment on the wrong contact."
            : "Paid us and were never billed through this app at all. The back catalogue."}
      </p>

      {shown.length === 0 ? (
        <p className="rounded-lg border border-border bg-card/60 px-3 py-6 text-center text-sm text-muted-foreground">
          Nothing in this list.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {shown.map((balance) => (
            <li key={balance.customerId}>
              <Link
                href={`/clients/${balance.customerId}`}
                className="flex items-start justify-between gap-2 rounded-lg border border-border bg-card/60 p-3 hover:border-primary"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">
                    {balance.customerName ?? "Unnamed contact"}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {money(balance.billedCents)} billed · {money(balance.receivedCents)} in ·{" "}
                    {balance.invoices === 0
                      ? "no invoices"
                      : `${balance.invoices} invoice${balance.invoices === 1 ? "" : "s"}`}
                  </span>
                </span>
                <span
                  className={`shrink-0 text-base font-bold ${
                    view === "owed" ? "text-amber-600 dark:text-amber-400" : ""
                  }`}
                >
                  {money(view === "owed" ? balance.owedCents : balance.creditCents)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="rounded-lg border border-border bg-card/60 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-lg font-bold ${tone === "warn" ? "text-amber-600 dark:text-amber-400" : ""}`}>
        {value}
      </p>
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
        active ? "bg-foreground text-background" : "border border-border bg-card/60"
      }`}
    >
      {children}
    </button>
  );
}
