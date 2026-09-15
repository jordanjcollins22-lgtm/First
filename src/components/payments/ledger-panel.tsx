"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { categoriesFor, categoryLabel, PAYMENT_METHODS } from "@/lib/ledger";
import { deleteLedgerEntry, recordLedgerEntry } from "@/lib/actions/ledger-actions";
import type { PaymentsData } from "@/lib/data/payments";
import type { LedgerCategory, LedgerDirection } from "@/types/domain";

function money(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Cash, checks, materials runs, subcontractors — everything that never touches
 * Stripe or payroll, which in this business is most of the money.
 *
 * One form for both directions rather than two: the only thing that changes is
 * the category list, and a single "what happened" box is faster on a phone in
 * a truck than hunting for the right screen.
 */
export function LedgerPanel({
  entries,
  totals,
  jobOptions,
}: {
  entries: PaymentsData["ledger"];
  totals: PaymentsData["ledgerTotals"];
  jobOptions: PaymentsData["jobOptions"];
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Tile label="In" value={money(totals.in)} tone="in" />
        <Tile label="Out" value={money(totals.out)} tone="out" />
        <Tile label="Net" value={money(totals.net)} tone={totals.net < 0 ? "out" : "neutral"} />
      </div>

      <EntryForm jobOptions={jobOptions} />

      {totals.byCategory.length > 0 && (
        <section className="rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
          <h2 className="mb-2 text-sm font-semibold">Where it went</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {totals.byCategory.map((row) => (
              <li key={row.category} className="flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                  {row.direction === "in" ? (
                    <ArrowDownLeft className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  ) : (
                    <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                  )}
                  <span className="truncate">{row.label}</span>
                </span>
                <span className="shrink-0 tabular-nums">{money(row.total)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <EntryList entries={entries} />
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone: "in" | "out" | "neutral" }) {
  const color = tone === "in" ? "text-emerald-700" : tone === "out" ? "text-destructive" : "";
  return (
    <div className="rounded-xl border border-white/60 bg-card/60 p-3 backdrop-blur-md">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-bold tabular-nums sm:text-xl ${color}`}>{value}</p>
    </div>
  );
}

function EntryForm({ jobOptions }: { jobOptions: PaymentsData["jobOptions"] }) {
  const [direction, setDirection] = useState<LedgerDirection>("in");
  const [category, setCategory] = useState<LedgerCategory>("job_payment");
  const [amount, setAmount] = useState("");
  const [occurredOn, setOccurredOn] = useState(today());
  const [method, setMethod] = useState("");
  const [party, setParty] = useState("");
  const [jobId, setJobId] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  /** Switching direction re-picks the category — the old one belongs to the
   * other side of the book and the database would reject it. */
  function switchDirection(next: LedgerDirection) {
    setDirection(next);
    setCategory(categoriesFor(next)[0].value);
  }

  function submit(e: React.FormEvent) {
    // onSubmit, not a form action — an action clears the fields before
    // validation gets to read them.
    e.preventDefault();
    setError(null);
    setMessage(null);

    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return setError("Enter an amount greater than zero.");
    if (!occurredOn) return setError("Pick the date it happened.");

    startTransition(async () => {
      const result = await recordLedgerEntry({
        direction,
        category,
        amount: value,
        occurredOn,
        method: method || null,
        party: party || null,
        jobId: jobId || null,
        note: note || null,
      });
      if (!result.ok) return setError(result.message);
      setAmount("");
      setParty("");
      setNote("");
      setMessage(result.message ?? "Recorded.");
    });
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <div className="mb-3 grid grid-cols-2 gap-2">
        {(["in", "out"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => switchDirection(option)}
            className={`flex min-h-11 items-center justify-center gap-1.5 rounded-lg border text-sm font-semibold ${
              direction === option
                ? option === "in"
                  ? "border-emerald-600 bg-emerald-50 text-emerald-800"
                  : "border-amber-600 bg-amber-50 text-amber-900"
                : "border-border text-muted-foreground"
            }`}
          >
            {option === "in" ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
            Money {option}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-medium">
          Amount
          <Input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium">
          Date
          <Input type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium">
          Category
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as LedgerCategory)}
            className="min-h-11 rounded-lg border border-border bg-background px-3 text-base sm:text-sm"
          >
            {categoriesFor(direction).map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium">
          Method
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="min-h-11 rounded-lg border border-border bg-background px-3 text-base sm:text-sm"
          >
            <option value="">—</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m[0].toUpperCase() + m.slice(1)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium">
          {direction === "in" ? "From" : "To"}
          <Input
            value={party}
            onChange={(e) => setParty(e.target.value)}
            placeholder={direction === "in" ? "Client name" : "Supplier or sub"}
          />
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium">
          Job (optional)
          <select
            value={jobId}
            onChange={(e) => setJobId(e.target.value)}
            className="min-h-11 rounded-lg border border-border bg-background px-3 text-base sm:text-sm"
          >
            <option value="">Not tied to a job</option>
            {jobOptions.map((j) => (
              <option key={j.id} value={j.id}>
                {j.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="mt-3 flex flex-col gap-1 text-xs font-medium">
        Note
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What it was for" />
      </label>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      {message && <p className="mt-2 text-xs text-emerald-700">{message}</p>}

      <Button type="submit" disabled={isPending} className="mt-3 min-h-11 w-full sm:w-auto">
        {isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
        Record
      </Button>
    </form>
  );
}

function EntryList({ entries }: { entries: PaymentsData["ledger"] }) {
  if (entries.length === 0) {
    return (
      <p className="rounded-xl border border-white/60 bg-card/60 p-4 text-sm text-muted-foreground backdrop-blur-md">
        Nothing recorded yet. Cash jobs, checks, materials runs and subcontractors go here.
      </p>
    );
  }

  return (
    <section className="rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <h2 className="mb-2 text-sm font-semibold">History ({entries.length})</h2>
      <ul className="flex flex-col gap-2">
        {entries.map((entry) => (
          <EntryRow key={entry.id} entry={entry} />
        ))}
      </ul>
    </section>
  );
}

function EntryRow({ entry }: { entry: PaymentsData["ledger"][number] }) {
  const [removed, setRemoved] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (removed) return null;
  const isIn = entry.direction === "in";

  return (
    <li className="rounded-lg border border-border p-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
          {isIn ? (
            <ArrowDownLeft className="h-4 w-4 shrink-0 text-emerald-600" />
          ) : (
            <ArrowUpRight className="h-4 w-4 shrink-0 text-amber-600" />
          )}
          <span className="truncate">{entry.party || categoryLabel(entry.category)}</span>
        </span>
        <span className={`shrink-0 text-sm font-semibold tabular-nums ${isIn ? "text-emerald-700" : ""}`}>
          {isIn ? "+" : "−"}
          {money(entry.amount)}
        </span>
      </div>

      <p className="mt-0.5 text-[11px] text-muted-foreground">
        {[categoryLabel(entry.category), entry.occurred_on, entry.method].filter(Boolean).join(" · ")}
      </p>

      {entry.job_id && (
        <Link href={`/jobs/${entry.job_id}`} className="text-[11px] text-primary hover:underline">
          {entry.jobAddress || entry.jobName || "View job"}
        </Link>
      )}

      {entry.note && <p className="mt-0.5 text-xs text-muted-foreground">{entry.note}</p>}

      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await deleteLedgerEntry(entry.id);
            if (result.ok) setRemoved(true);
          })
        }
        className="mt-1 flex min-h-8 items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Remove
      </button>
    </li>
  );
}
