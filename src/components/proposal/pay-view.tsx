"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { surchargeCents, surchargeNotice } from "@/lib/card-surcharge";
import {
  optionsAfterAccept,
  type AcceptanceContext,
  type PaymentOption,
} from "@/lib/acceptance-path";
import {
  chooseOfflinePayment,
  choosePaymentPath,
  startProposalPayment,
} from "@/lib/actions/public-proposal-actions";
import type { OfflineMethod } from "@/lib/collect-payment";
import { PREVIEW_BLOCKED, schedulePath } from "@/lib/proposal-flow";
import { PayInPlace } from "@/components/proposal/pay-in-place";

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}


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
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Once this is set the wallets are on screen and the options are behind
  // them, because a list of choices above a card form is a chance to change
  // your mind while holding your phone to your face.
  const [paying, setPaying] = useState<{ clientSecret: string; amount: number } | null>(null);
  // Cash or check: the choice, then the confirmation before moving on.
  const [offline, setOffline] = useState<"closed" | "choosing" | "done">("closed");
  const [offlineMessage, setOfflineMessage] = useState<string | null>(null);

  function chooseOffline(method: OfflineMethod) {
    if (preview) {
      setError(PREVIEW_BLOCKED);
      return;
    }
    setError(null);
    setBusyId(method);
    start(async () => {
      const result = await chooseOfflinePayment({ token, method });
      setBusyId(null);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setOfflineMessage(result.message);
      setOffline("done");
      setTimeout(() => router.push(result.next), 2500);
    });
  }

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
          instalments: 1,
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
        // One. Splitting is arranged by the office against an invoice now,
        // not chosen by a client on the proposal page.
        instalments: 1,
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
        {/* Not "how would you like to pay" any more. There is one way, and
            asking a question with one answer reads like something is
            missing. */}
        <h1 className="mt-1 text-2xl font-bold">Last step</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Settle up and pick the day you would like us.
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
        return (
          <div
            key={option.id}
            className="flex flex-col gap-3 rounded-2xl border border-border bg-background p-4"
          >
            <div>
              <p className="font-semibold">{option.label}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{option.detail}</p>
            </div>

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
                : `${canCharge ? "Pay" : "Confirm"} ${money(amount)}`}
            </Button>

            {/* Before the tap, never on the receipt. A surcharge has to be
                disclosed ahead of the payment, and somebody who would rather
                write a cheque deserves to know that in time to. */}
            {canCharge && surchargeCents(amount) > 0 && (
              <p className="text-center text-xs text-muted-foreground">
                {surchargeNotice(amount)}
              </p>
            )}
          </div>
        );
      })}

      {/* The other way to pay, for the client who would rather not pay a
          card fee. Off to the side until asked for: the card button is the
          one most people want, and a choice presented as equal gets taken
          by people who did not mean to. */}
      {offline === "done" && offlineMessage ? (
        <div className="rounded-2xl border border-primary/40 bg-primary/5 p-4 text-center text-sm">{offlineMessage}</div>
      ) : offline === "choosing" ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-background p-4">
          <div>
            <p className="font-semibold">Pay by cash or check</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              No card fee. Your account manager will arrange a time to collect {money(context.totalCents)}.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" size="lg" variant="outline" disabled={pending} onClick={() => chooseOffline("check")}>
              {busyId === "check" ? "Just a moment…" : "Check"}
            </Button>
            <Button type="button" size="lg" variant="outline" disabled={pending} onClick={() => chooseOffline("cash")}>
              {busyId === "cash" ? "Just a moment…" : "Cash"}
            </Button>
          </div>
          <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setOffline("closed")}>
            Never mind, I&apos;ll pay by card
          </button>
        </div>
      ) : (
        <button type="button" className="text-center text-sm text-primary underline" onClick={() => setOffline("choosing")}>
          Rather pay by cash or check?
        </button>
      )}

        </>
      )}

      {error && <p className="text-center text-sm text-destructive">{error}</p>}

      <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
        <Lock className="h-3.5 w-3.5" />
        {canCharge
          ? "Card, Apple Pay and Google Pay, handled by Stripe."
          : "We will email your invoice, and a team member will reach out to get you booked in."}
      </p>
    </div>
  );
}
