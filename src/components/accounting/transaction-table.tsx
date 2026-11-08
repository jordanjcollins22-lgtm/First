"use client";

import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { money } from "@/lib/accounting/format";
import { getCategory } from "@/lib/accounting/schedule-c";
import {
  approveTransactions,
  suggestWithClaude,
  updateTransactionCategory,
  updateTransactionNote,
} from "@/lib/actions/accounting-actions";

import { CategoryOptions, SELECT_CLASS } from "./category-select";

export interface TableTransaction {
  id: string;
  posted_on: string;
  description: string;
  merchant_name: string | null;
  amount: number;
  category: string;
  category_source: string;
  needs_review: boolean;
  categorization_reason: string | null;
  notes: string | null;
  account: { name: string; mask: string | null } | null;
}

type Status = { error?: string; message?: string } | null;

export function TransactionTable({
  transactions,
  year,
  aiEnabled,
}: {
  transactions: TableTransaction[];
  year: number;
  aiEnabled: boolean;
}) {
  const [status, setStatus] = useState<Status>(null);
  const [isPending, startTransition] = useTransition();
  const approvable = transactions.filter((t) => t.needs_review && t.category !== "uncategorized");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {approvable.length > 0 && (
          <Button
            size="sm"
            disabled={isPending}
            onClick={() => {
              if (!confirm(`Approve the suggested category on ${approvable.length} transactions? Only do this after scanning them.`)) return;
              startTransition(async () => setStatus(await approveTransactions(approvable.map((t) => t.id))));
            }}
          >
            Approve {approvable.length} suggestions shown
          </Button>
        )}
        {aiEnabled && (
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => startTransition(async () => setStatus(await suggestWithClaude(year)))}
          >
            {isPending ? "Working…" : "Ask Claude to suggest categories"}
          </Button>
        )}
        {status?.error && <p className="text-sm text-destructive">{status.error}</p>}
        {status?.message && <p className="text-sm text-green-700">{status.message}</p>}
      </div>

      {transactions.length === 0 ? (
        <p className="rounded-md border border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Nothing here.
        </p>
      ) : (
        <div className="divide-y divide-border rounded-md border border-border bg-card">
          {transactions.map((t) => (
            <TransactionRow key={t.id} tx={t} onStatus={setStatus} />
          ))}
        </div>
      )}
    </div>
  );
}

function TransactionRow({ tx, onStatus }: { tx: TableTransaction; onStatus: (s: Status) => void }) {
  const [remember, setRemember] = useState(false);
  const [showNote, setShowNote] = useState(Boolean(tx.notes));
  const [note, setNote] = useState(tx.notes ?? "");
  const [isPending, startTransition] = useTransition();
  const category = getCategory(tx.category);

  return (
    <div className="grid grid-cols-1 gap-2 px-3 py-3 md:grid-cols-[6.5rem_1fr_7rem_18rem] md:items-start">
      <div className="text-sm text-muted-foreground">{tx.posted_on}</div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium" title={tx.description}>
          {tx.merchant_name ? `${tx.merchant_name} · ` : ""}
          {tx.description}
        </p>
        <p className="text-xs text-muted-foreground">
          {tx.account ? `${tx.account.name}${tx.account.mask ? ` ••${tx.account.mask}` : ""} · ` : ""}
          {tx.categorization_reason ?? ""}
        </p>
        {category.auditNote && <p className="mt-1 text-xs text-amber-700">{category.auditNote}</p>}
        {showNote ? (
          <input
            className="mt-1 w-full rounded border border-input bg-card px-2 py-1 text-xs"
            placeholder="Receipt / business purpose (e.g. lunch w/ client Smith re: spring install)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => {
              if (note !== (tx.notes ?? "")) startTransition(async () => onStatus(await updateTransactionNote(tx.id, note)));
            }}
          />
        ) : (
          <button type="button" className="mt-1 text-xs text-primary hover:underline" onClick={() => setShowNote(true)}>
            + note
          </button>
        )}
      </div>
      <div className={`text-sm font-semibold tabular-nums md:text-right ${tx.amount > 0 ? "text-green-700" : ""}`}>
        {money(tx.amount)}
      </div>
      <div className="flex flex-col gap-1">
        <select
          className={SELECT_CLASS}
          value={tx.category}
          disabled={isPending}
          onChange={(e) => {
            const value = e.target.value;
            startTransition(async () => onStatus(await updateTransactionCategory(tx.id, value, remember)));
          }}
        >
          <CategoryOptions />
        </select>
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Always use for this merchant
          </label>
          {tx.needs_review ? (
            tx.category !== "uncategorized" ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                disabled={isPending}
                onClick={() => startTransition(async () => onStatus(await approveTransactions([tx.id])))}
              >
                Approve
              </Button>
            ) : (
              <Badge variant="destructive">Pick one</Badge>
            )
          ) : (
            <Badge variant="secondary">{tx.category_source === "manual" ? "Set by you" : "Approved"}</Badge>
          )}
        </div>
      </div>
    </div>
  );
}
