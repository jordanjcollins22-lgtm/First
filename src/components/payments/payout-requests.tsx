"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { decidePayout, markPayoutSent } from "@/lib/actions/payout-actions";
import type { PayoutRequestRow, PayoutStatus } from "@/lib/wallet";
import { cn } from "@/lib/utils";

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

const LABEL: Record<PayoutStatus, string> = {
  requested: "Asked",
  approved: "Approved, not sent",
  declined: "Declined",
  sent: "Sent",
  cancelled: "Taken back",
};

/**
 * Payout requests from people's wallets, on the Money page. Approve or say
 * why not, then mark it sent once the money has actually gone to their bank.
 * Nothing here sends money.
 */
export function PayoutRequests({ requests }: { requests: PayoutRequestRow[] }) {
  const open = requests.filter((r) => r.status === "requested" || r.status === "approved");
  const done = requests.filter((r) => !open.includes(r)).slice(0, 8);
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3">
      <div>
        <h3 className="font-semibold">Wallet payouts</h3>
        <p className="text-xs text-muted-foreground">
          Asked for from someone&apos;s wallet. Approve it, send it to their bank yourself, then mark it sent so it leaves their wallet.
        </p>
      </div>
      {open.length === 0 ? <p className="text-sm text-muted-foreground">Nothing waiting.</p> : open.map((r) => <OpenRequest key={r.id} r={r} />)}
      {done.length > 0 && (
        <ul className="flex flex-col divide-y divide-border border-t border-border">
          {done.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span>
                {r.person} · {money(r.amount)} <span className="text-xs text-muted-foreground">asked {day(r.requestedAt)}{r.decisionNote ? `: ${r.decisionNote}` : ""}</span>
              </span>
              <span className="text-xs font-semibold">{LABEL[r.status]}{r.sentAt ? ` ${day(r.sentAt)}` : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function OpenRequest({ r }: { r: PayoutRequestRow }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [why, setWhy] = useState("");
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  function run(task: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>) {
    setNote(null);
    start(async () => {
      const result = await task();
      setNote(result.ok ? { ok: true, text: result.message } : { ok: false, text: result.error });
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">
          {r.person} · {money(r.amount)}
        </span>
        <span className="text-xs text-muted-foreground">
          {LABEL[r.status]} · asked {day(r.requestedAt)}
        </span>
      </div>
      {r.status === "requested" ? (
        <>
          <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why not (only if declining)" className="h-9 rounded-md border border-border bg-background px-2 text-sm" />
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" disabled={busy} onClick={() => run(() => decidePayout(r.id, true, ""))}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Approve
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => run(() => decidePayout(r.id, false, why))}>
              Decline
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <input value={method} onChange={(e) => setMethod(e.target.value)} placeholder="How (Zelle, check…)" className="h-9 rounded-md border border-border bg-background px-2 text-sm" />
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Reference" className="h-9 rounded-md border border-border bg-background px-2 text-sm" />
          </div>
          <Button type="button" disabled={busy} onClick={() => run(() => markPayoutSent(r.id, { method, reference }))}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            I sent it. Mark it sent
          </Button>
        </>
      )}
      {note && <p className={cn("text-sm", note.ok ? "text-emerald-700" : "text-destructive")}>{note.text}</p>}
    </div>
  );
}
