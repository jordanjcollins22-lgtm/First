"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  optionsAfterAccept,
  type AcceptanceContext,
  type PaymentOption,
} from "@/lib/acceptance-path";
import {
  choosePaymentPath,
  startProposalPayment,
} from "@/lib/actions/public-proposal-actions";
import { PREVIEW_BLOCKED, schedulePath } from "@/lib/proposal-flow";
import { PayInPlace } from "@/components/proposal/pay-in-place";

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const COUNTS = [2, 3, 4, 6];

/**
 * One question, one screen, one tap.
 *
 * Paying in full is a single button that opens the card form. Splitting it
 * needs a number first, so the counts are on the card rather than behind a
 * second tap, and the button under them commits.
 */
export function PayView({
  token,
  context,
  organizationName,
  preview,
  canCharge,
  publishableKey,
  returnUrl,
}: {
  token: string;
  context: AcceptanceContext;
  organizationName: string;
  preview: boolean;
  /** False when we cannot take a card yet and will invoice instead. */
  canCharge: boolean;
  /** Empty when we cannot take a card on this page and must redirect. */
  publishableKey: string;
  returnUrl: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [instalments, setInstalments] = useState(3);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Once this is set the wallets are on screen and the options are behind
  // them, because a list of choices above a card form is a chance to change
  // your mind while holding your phone to your face.
  const [paying, setPaying] = useState<{ clientSecret: string; amount: number } | null>(null);

  const options = optionsAfterAccept(context);

  function choose(option: PaymentOption) {
    if (preview) {
      setError(PREVIEW_BLOCKED);
      return;
    }
    setError(null);
    setBusyId(option.id);

    // Straight to the wallet sheet where we can. The redirect below is the
    // fallback for a business that has not put its publishable key in yet.
    if (publishableKey) {
      start(async () => {
        const result = await startProposalPayment({
          token,
          pathId: option.id,
          instalments,
        });
        setBusyId(null);
        if (result.ok) setPaying({ clientSecret: result.clientSecret, amount: result.amountCents });
        else setError(result.message);
      });
      return;
    }

    start(async () => {
      const result = await choosePaymentPath({
        token,
        pathId: option.id,
        instalments,
      });
      if (!result.ok) {
        setBusyId(null);
        setError(result.message);
        return;
      }
      // Straight to the card form. Their browser fills it in for them there,
      // which is the whole reason it is Stripe's page and not ours.
      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
        return;
      }
      router.push(result.next ?? schedulePath(token));
    });
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 px-4 py-10">
      <div className="text-center">
        <p className="text-sm font-semibold uppercase tracking-wide text-primary">
          {organizationName}
        </p>
        <h1 className="mt-1 text-2xl font-bold">How would you like to pay?</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          This is the last thing we need, and it decides when we can book you in.
        </p>
      </div>

      {preview && (
        <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-center text-xs font-semibold text-amber-700">
          Internal preview. Nothing here charges anybody.
        </div>
      )}

      {paying ? (
        <PayInPlace
          publishableKey={publishableKey}
          clientSecret={paying.clientSecret}
          amountLabel={money(paying.amount)}
          returnUrl={returnUrl}
        />
      ) : (
        <>
      {options.map((option) => {
        const amount = option.keepsDiscount
          ? context.totalCents
          : context.totalCents + context.discountCents;
        const split = option.id !== "full";
        return (
          <div
            key={option.id}
            className="flex flex-col gap-3 rounded-2xl border border-border bg-background p-4"
          >
            <div>
              <p className="font-semibold">{option.label}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{option.detail}</p>
            </div>

            {split && (
              <div className="flex flex-col gap-1.5">
                <p className="text-xs text-muted-foreground">How many payments?</p>
                <div className="flex flex-wrap gap-1.5">
                  {COUNTS.map((count) => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => setInstalments(count)}
                      className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold ${
                        instalments === count
                          ? "border-transparent bg-foreground text-background"
                          : "border-border text-muted-foreground"
                      }`}
                    >
                      {count}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <Button
              type="button"
              size="xl"
              variant={option.id === "full" ? "default" : "outline"}
              className="w-full"
              disabled={pending}
              onClick={() => choose(option)}
            >
              {busyId === option.id
                ? canCharge
                  ? "Opening secure checkout…"
                  : "Just a moment…"
                : split
                  ? `${canCharge ? "Pay" : "Start with"} ${money(Math.round(amount / instalments))} today`
                  : `${canCharge ? "Pay" : "Confirm"} ${money(amount)}`}
            </Button>

            {/* Roughly, and said so. The exact split lands on the schedule we
                email, where the remainder goes on the earliest payments
                rather than being left to rounding. */}
            {split && (
              <p className="text-center text-xs text-muted-foreground">
                Then about {money(Math.round(amount / instalments))} a month until it is cleared.
              </p>
            )}
          </div>
        );
      })}

        </>
      )}

      {error && <p className="text-center text-sm text-destructive">{error}</p>}

      <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
        <Lock className="h-3.5 w-3.5" />
        {canCharge
          ? "Card, Apple Pay and Google Pay, handled by Stripe."
          : "We will email your invoice, and nothing is due until we have your day booked."}
      </p>
    </div>
  );
}
