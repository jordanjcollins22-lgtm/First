"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { submitSubQuote } from "@/lib/actions/sub-quote-actions";

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * The box for the contractor's price.
 *
 * One number for the whole service, not one per area: a soft washer prices
 * the trip, and asking for four numbers where they think in one is how a
 * form gets abandoned. Notes are for "the mailbox is extra" and the like.
 */
export function QuoteForm({
  token,
  serviceLabel,
  areaCount,
  closed,
  existing,
  businessPhone,
}: {
  token: string;
  serviceLabel: string;
  areaCount: number;
  closed: boolean;
  existing: { name: string; amount: number; note: string; at: string | null } | null;
  businessPhone: string | null;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState(existing ? String(existing.amount) : "");
  const [note, setNote] = useState(existing?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

  if (closed) {
    return (
      <p className="rounded-xl border border-border bg-muted/40 p-4 text-sm">
        This request is closed. Thanks for looking{businessPhone ? `, and call or text ${businessPhone} with any questions` : ""}.
      </p>
    );
  }

  if (saved != null) {
    return (
      <div className="rounded-xl border border-emerald-600/40 bg-emerald-50 p-4 text-sm">
        <p className="font-semibold">Got it. {money(saved)} for {serviceLabel}.</p>
        <p className="mt-1 text-muted-foreground">We will be in touch. If you need to change it, come back to this same link.</p>
      </div>
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await submitSubQuote({ token, name, phone, email, amount, note });
      if (!result.ok) return setError(result.message);
      setSaved(Number(amount.replace(/[^0-9.]/g, "")));
    });
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-border p-4">
      <h2 className="text-base font-semibold">Your price</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">
        One price for all {areaCount} area{areaCount === 1 ? "" : "s"}, labour and materials.
      </p>
      {existing && (
        <p className="mt-2 text-xs text-muted-foreground">
          You already sent {money(existing.amount)}. Sending again replaces it.
        </p>
      )}

      <div className="mt-3 grid gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium">
          Price
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="$" className="text-lg" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          Your name or company
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Who is quoting" />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-medium">
            Phone
            <Input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Best number" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Email
            <Input inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Optional" />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-xs font-medium">
          Anything we should know
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Lead time, what is or isn't included, questions."
            className="rounded-lg border border-border bg-background px-3 py-2 text-base sm:text-sm"
          />
        </label>
      </div>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <Button type="submit" disabled={isPending} className="mt-4 min-h-11 w-full">
        {isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
        Send price
      </Button>
    </form>
  );
}
