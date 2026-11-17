"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { requestPayout, withdrawPayout } from "@/lib/actions/payout-actions";
import type { Wallet } from "@/lib/wallet";
import { cn } from "@/lib/utils";

const money = (n: number) =>
  `$${Math.abs(n).toLocaleString("en-US", Number.isInteger(n) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/**
 * The affiliate's wallet. Their 4% lands here once the client pays. Request
 * payout only asks: the office approves it and sends it to their bank, and
 * it leaves the wallet when it's marked sent.
 */
export function WalletCard({ wallet }: { wallet: Wallet }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  function run(task: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>) {
    setNote(null);
    start(async () => {
      const r = await task();
      setNote(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
      if (r.ok) router.refresh();
    });
  }

  const open = wallet.open;
  return (
    <div className="grid gap-3">
      <dl className="grid gap-0 divide-y rounded-xl border">
        <Line label="Ready to pay out" value={money(wallet.ready)} strong />
        <Line label="Waiting on client to pay" value={money(wallet.waiting)} />
        {wallet.onHold > 0 && <Line label="On hold until a job is put right" value={money(wallet.onHold)} />}
      </dl>

      {open ? (
        <div className="rounded-xl border border-sky-300 bg-sky-50/60 p-3 text-sm dark:bg-sky-500/10">
          <p className="font-semibold">
            You asked for {money(open.amount)} on {day(open.requestedAt)}.
          </p>
          <p className="text-xs text-muted-foreground">
            {open.status === "approved" ? "Approved. The office is sending it to your bank." : "Waiting on the office to approve it. Then they send it to your bank."}
          </p>
          {open.status === "requested" && (
            <button type="button" disabled={busy} className="mt-1 text-xs font-medium underline" onClick={() => run(() => withdrawPayout(open.id))}>
              Take it back
            </button>
          )}
        </div>
      ) : (
        <Button type="button" className="h-12 text-base" disabled={busy || wallet.canRequest <= 0} onClick={() => run(requestPayout)}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {wallet.canRequest > 0 ? `Request payout of ${money(wallet.canRequest)}` : "Request payout"}
        </Button>
      )}
      {note && <p className={cn("text-sm", note.ok ? "text-emerald-700 dark:text-emerald-300" : "text-destructive")}>{note.text}</p>}
      <p className="text-xs text-muted-foreground">
        Your 4% lands here once the client pays. A payout is a request: the office approves it, then sends it to your bank.
      </p>

      {wallet.history.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">History</p>
          <ul className="divide-y rounded-xl border">
            {wallet.history.map((h, i) => (
              <li key={i} className="flex items-baseline justify-between gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 truncate">
                  {h.at ? `${day(h.at)} · ` : ""}
                  {h.label}
                </span>
                <span className={cn("shrink-0 font-semibold tabular-nums", h.amount >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-foreground")}>
                  {h.amount >= 0 ? "+" : "−"}
                  {money(h.amount)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2 px-3 py-2">
      <dt className={cn("text-sm", strong ? "font-semibold" : "text-muted-foreground")}>{label}</dt>
      <dd className={cn("tabular-nums", strong ? "text-lg font-extrabold" : "font-semibold")}>{value}</dd>
    </div>
  );
}
