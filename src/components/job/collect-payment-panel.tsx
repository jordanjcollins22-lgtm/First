"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banknote, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { markPaymentCollected } from "@/lib/actions/collect-payment-actions";
import { awaitingLine, type CollectMethod } from "@/lib/collect-payment";
import { dateShort } from "@/lib/time-zone";
import type { Invoice } from "@/types/domain";

/**
 * Marking the cash or the check as picked up.
 *
 * When the client asked to pay this way the card says so, loudly, until
 * somebody presses the button. When they did not, the same form is a quiet
 * link, because a check handed over at the door still has to be recorded.
 */
export function CollectPaymentPanel({ invoice }: { invoice: Invoice }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<CollectMethod>(invoice.pay_by ?? "check");
  const [amount, setAmount] = useState(String(Math.round(invoice.amount)));
  const [receivedAt, setReceivedAt] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  if (invoice.status !== "open") return null;
  const awaiting = invoice.pay_by != null;

  function submit() {
    const cents = Math.round(Number(amount) * 100);
    setResult(null);
    startTransition(async () => {
      const outcome = await markPaymentCollected({
        invoiceId: invoice.id,
        method,
        amountCents: cents,
        receivedAt: receivedAt || undefined,
        note: note || undefined,
      });
      setResult(outcome);
      if (outcome.ok) router.refresh();
    });
  }

  return (
    <div className={awaiting ? "rounded-lg border border-amber-400/50 bg-amber-400/10 p-3" : "px-1"}>
      {awaiting && (
        <p className="flex items-start gap-2 text-sm font-medium text-amber-900">
          <Banknote className="mt-0.5 h-4 w-4 shrink-0" />
          {awaitingLine(invoice.pay_by!, invoice.pay_by_requested_at, dateShort)}
        </p>
      )}

      {!open ? (
        <Button
          type="button"
          size="sm"
          variant={awaiting ? "default" : "ghost"}
          className={awaiting ? "mt-2" : "h-7 px-2 text-xs text-muted-foreground"}
          onClick={() => setOpen(true)}
        >
          {awaiting ? `Mark ${invoice.pay_by} picked up` : "Record cash, check or Zelle received"}
        </Button>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <select value={method} onChange={(e) => setMethod(e.target.value as CollectMethod)} className="h-8 rounded-md border border-border bg-background px-2 text-sm">
              <option value="check">Check</option>
              <option value="cash">Cash</option>
              <option value="zelle">Zelle</option>
              <option value="transfer">Bank transfer</option>
            </select>
            <div className="flex items-center gap-1">
              <span className="text-sm">$</span>
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="h-8 w-28 text-sm" />
            </div>
            <Input type="date" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} className="h-8 w-40 text-sm" title="Day received, if not today" />
          </div>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Check number or note (optional)" className="h-8 text-sm" />
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={pending || !(Number(amount) > 0)} onClick={submit}>
              {pending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              {method === "cash" || method === "check" ? "Picked up, mark paid" : "Received, mark paid"}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Records the payment on the job, marks the invoice paid, and tells Stripe it was paid outside the card page.</p>
        </div>
      )}

      {result && (
        <p className={`mt-2 rounded-lg px-3 py-2 text-sm ${result.ok ? "bg-emerald-500/15 text-emerald-700" : "bg-amber-500/15 text-amber-800"}`}>{result.message}</p>
      )}
    </div>
  );
}
