"use client";

import { useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { recordCommissionPaid } from "@/lib/actions/commission-actions";

interface PayableLine {
  jobId: string;
  customerName: string;
  amount: number;
}

function money(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

/**
 * Recording commission that has gone out.
 *
 * A payment is usually one transfer covering several jobs, and it is written
 * down as one row per job, because the question anybody asks afterwards is
 * about a job: an account manager looking at a project wants to know whether
 * that project has been paid. The reference is what ties the rows back
 * together against a bank statement.
 *
 * Every payable job is ticked to start with. Somebody paying a manager pays
 * what is owed, and making them tick six boxes to say so is a way to have
 * five of them paid.
 */
export function MarkCommissionPaid({ profileId, lines }: { profileId: string; lines: PayableLine[] }) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set(lines.map((line) => line.jobId)));
  const [reference, setReference] = useState("");
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (lines.length === 0) return null;

  const picked = lines.filter((line) => chosen.has(line.jobId));
  const total = picked.reduce((sum, line) => sum + line.amount, 0);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-3 w-full rounded-lg border border-emerald-500/40 bg-emerald-50/60 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-50"
      >
        Mark {money(lines.reduce((sum, line) => sum + line.amount, 0))} paid
      </button>
    );
  }

  return (
    <div className="mb-3 flex flex-col gap-2 rounded-lg border border-emerald-500/40 bg-emerald-50/40 p-2.5">
      <p className="text-xs font-semibold">What this payment covers</p>
      <ul className="flex flex-col gap-1">
        {lines.map((line) => (
          <li key={line.jobId}>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                className="h-3.5 w-3.5"
                checked={chosen.has(line.jobId)}
                onChange={() =>
                  setChosen((prev) => {
                    const next = new Set(prev);
                    if (next.has(line.jobId)) next.delete(line.jobId);
                    else next.add(line.jobId);
                    return next;
                  })
                }
              />
              <span className="min-w-0 flex-1 truncate">{line.customerName}</span>
              <span className="shrink-0 tabular-nums font-medium">{money(line.amount)}</span>
            </label>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[11px]">
          <span className="text-muted-foreground">Paid on</span>
          <Input
            type="date"
            value={paidAt}
            onChange={(e) => setPaidAt(e.target.value)}
            className="h-8 w-36 text-xs"
          />
        </label>
        <label className="flex min-w-40 flex-1 flex-col gap-1 text-[11px]">
          <span className="text-muted-foreground">Reference</span>
          <Input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Cheque number, transfer reference"
            className="h-8 text-xs"
          />
        </label>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="h-8"
          disabled={isPending || picked.length === 0}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await recordCommissionPaid({
                profileId,
                lines: picked.map((line) => ({ jobId: line.jobId, amount: line.amount })),
                paidAt: paidAt ? new Date(`${paidAt}T12:00:00`).toISOString() : null,
                reference: reference.trim() || null,
              });
              if (result.ok) setOpen(false);
              else setError(result.error);
            });
          }}
        >
          {isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}
          Record {money(total)} paid
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
