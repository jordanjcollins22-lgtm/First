"use client";

import { useState } from "react";
import { AlertCircle, Check, HandCoins } from "lucide-react";

import { ChosenContact, ContactPicker } from "@/components/payments/contact-picker";
import { recordManualPayment } from "@/lib/actions/payment-plan-actions";
import { toCents } from "@/lib/payment-plan";
import type { SearchableContact } from "@/lib/payer-match";

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "check", label: "Check" },
  { value: "card", label: "Card" },
  { value: "other", label: "Other" },
];

/**
 * Money that arrived somewhere the software was not looking.
 *
 * A cheque in the post, cash on the driveway, a transfer straight to the
 * bank. None of it comes through Stripe and none of it comes through an
 * export, so without this it exists only in somebody's memory.
 *
 * No project required. Most of the back catalogue is money against a contact
 * with no project on file, and refusing to record it until somebody makes one
 * is how it stays unrecorded.
 */
export function RecordPaymentPanel({ onRecorded }: { onRecorded?: () => void }) {
  const [open, setOpen] = useState(false);
  const [contact, setContact] = useState<SearchableContact | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("check");
  const [receivedAt, setReceivedAt] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const cents = toCents(Number(amount.replace(/[^0-9.]/g, "")) || 0);

  async function save() {
    if (!contact || cents <= 0) return;
    setBusy(true);
    setError(null);

    const result = await recordManualPayment({
      jobId: null,
      customerId: contact.id,
      amountCents: cents,
      method,
      receivedAt,
      note,
    });

    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }

    setDone(`Recorded against ${contact.name ?? "that contact"}.`);
    setAmount("");
    setNote("");
    onRecorded?.();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-card/60 px-3 py-2.5 text-sm font-semibold"
      >
        <HandCoins className="h-4 w-4" /> Record a payment by hand
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <HandCoins className="h-4 w-4" /> Record a payment
        </p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs font-semibold text-muted-foreground underline-offset-2 hover:underline"
        >
          Close
        </button>
      </div>

      <p className="mb-2 text-xs text-muted-foreground">
        Cash, a cheque, a bank transfer — anything that did not come through the card processor.
      </p>

      {contact ? (
        <div className="mb-2">
          <ChosenContact contact={contact} onClear={() => setContact(null)} />
        </div>
      ) : (
        <ContactPicker onPick={setContact} placeholder="Who paid?" />
      )}

      {contact && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-0.5 block text-[11px] uppercase tracking-wide text-muted-foreground">
                Amount
              </span>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="$1,200"
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[11px] uppercase tracking-wide text-muted-foreground">
                Received
              </span>
              <input
                type="date"
                value={receivedAt}
                onChange={(e) => setReceivedAt(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {METHODS.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setMethod(m.value)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                  method === m.value
                    ? "bg-foreground text-background"
                    : "border border-border bg-background"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What it was for (optional)"
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          />

          <button
            type="button"
            disabled={busy || cents <= 0}
            onClick={save}
            className="w-full rounded-md bg-foreground px-3 py-2 text-sm font-semibold text-background disabled:opacity-50"
          >
            {busy ? "Recording…" : "Record it"}
          </button>

          <p className="text-[11px] text-muted-foreground">
            It lands against the contact. File it on a project from the list below.
          </p>
        </div>
      )}

      {error && (
        <p className="mt-2 flex items-start gap-1.5 text-xs font-medium text-destructive">
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}
      {done && (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
          <Check className="h-3.5 w-3.5" /> {done}
        </p>
      )}
    </div>
  );
}
