"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, RefreshCw } from "lucide-react";

import type { WebhookVerdict } from "@/lib/webhook-health";
import { needsAttention } from "@/lib/webhook-health";
import { syncStripeCheckoutsNow } from "@/lib/actions/stripe-settlement";

/**
 * Whether Stripe is telling this app about payments, and a way to ask it.
 *
 * Different from the banner above it. That one says whether Stripe is
 * there; this says whether it is talking to us, and a key that works
 * perfectly with no endpoint behind it passes the first and fails the
 * second. That exact state cost a thousand dollars of silence.
 *
 * The button is the backstop. It asks Stripe for everything paid recently
 * and records whatever we have no row for. Shown whether or not anything is
 * wrong, because the day it is needed is the day nobody knows yet.
 */
export function WebhookBanner({ verdict }: { verdict: WebhookVerdict | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  function pull() {
    setResult(null);
    start(async () => {
      const outcome = await syncStripeCheckoutsNow();
      if (!outcome.ok) {
        setResult(outcome.message);
        return;
      }
      const o = outcome.outcome;
      setResult(
        o.recorded === 0
          ? `Checked ${o.checked} paid on Stripe. Everything was already here.`
          : `Recorded ${o.recorded} ${o.recorded === 1 ? "payment" : "payments"} Stripe never delivered: ${o.recordedFor.join(", ")}.` +
              (o.unplaced > 0 ? ` ${o.unplaced} could not be placed.` : "")
      );
      router.refresh();
    });
  }

  const warn = verdict ? needsAttention(verdict) : false;

  return (
    <div
      className={`mb-4 rounded-lg border px-3 py-2.5 ${
        warn ? "border-amber-400/60 bg-amber-50/70 dark:border-amber-500/30 dark:bg-amber-500/10" : "border-border bg-card/60"
      }`}
    >
      {warn && verdict?.message && (
        <p className="mb-1.5 flex items-start gap-2 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-500" />
          <span>
            <span className="font-semibold">Stripe is not telling this app about payments.</span>{" "}
            <span className="text-muted-foreground">{verdict.message}</span>
          </span>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={pull}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`} />
          {pending ? "Asking Stripe…" : "Pull anything Stripe hasn't sent"}
        </button>
        <span className="text-xs text-muted-foreground">
          {result ?? "Also runs quietly every time this page opens."}
        </span>
      </div>
    </div>
  );
}
