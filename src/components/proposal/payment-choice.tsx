"use client";

import { useState, useTransition } from "react";
import { CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  optionsAfterAccept,
  type AcceptanceContext,
  type PaymentOption,
} from "@/lib/acceptance-path";
import { choosePaymentPath } from "@/lib/actions/public-proposal-actions";

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const COUNTS = [2, 3, 4, 6];

/**
 * The step that used to be a dead end.
 *
 * Accepting sent an invoice for the whole amount and showed a thank-you.
 * Anybody who wanted to spread the cost had to ring up and ask, so the ones
 * who did not ring simply did not pay. This asks them while they are still
 * looking at the screen, and whichever way they answer raises the right
 * paperwork and moves the job on.
 */
export function PaymentChoice({
  token,
  context,
  alreadyChosen,
}: {
  token: string;
  context: AcceptanceContext;
  /** They have answered before. Null while the choice is still open. */
  alreadyChosen: string | null;
}) {
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState<PaymentOption | null>(null);
  const [instalments, setInstalments] = useState(3);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const options = optionsAfterAccept(context);

  if (done) {
    return (
      <section className="flex flex-col items-center gap-2 rounded-2xl border border-primary/30 bg-primary/5 p-4 text-center">
        <CheckCircle2 className="h-8 w-8 text-primary" />
        <p className="text-sm">{done}</p>
      </section>
    );
  }

  // Already answered on another device or an earlier visit. Nothing to do,
  // and offering the buttons again would invite a second invoice.
  if (alreadyChosen) {
    return (
      <section className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-muted/30 p-4 text-center">
        <CheckCircle2 className="h-8 w-8 text-primary" />
        <p className="font-semibold">Thank you, that is all set.</p>
        <p className="text-sm text-muted-foreground">
          We have your payment choice and we will be in touch to book you in.
        </p>
      </section>
    );
  }

  function send(option: PaymentOption, count: number) {
    setError(null);
    start(async () => {
      const result = await choosePaymentPath({
        token,
        pathId: option.id,
        instalments: count,
      });
      if (result.ok) setDone(result.message);
      else setError(result.message);
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4">
      <div>
        <p className="text-lg font-semibold">Thank you. How would you like to pay?</p>
        <p className="text-sm text-muted-foreground">
          This is the last thing we need, and it decides when we can book you in.
        </p>
      </div>

      {options.map((option) => {
        const open = picked?.id === option.id;
        return (
          <div
            key={option.id}
            className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3"
          >
            <p className="text-sm font-semibold">{option.label}</p>
            <p className="text-sm text-muted-foreground">{option.detail}</p>

            {option.id !== "full" && open && (
              <div className="flex flex-col gap-1.5">
                <p className="text-xs text-muted-foreground">How many payments?</p>
                <div className="flex flex-wrap gap-1.5">
                  {COUNTS.map((count) => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => setInstalments(count)}
                      className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                        instalments === count
                          ? "border-transparent bg-foreground text-background"
                          : "border-border text-muted-foreground"
                      }`}
                    >
                      {count}
                    </button>
                  ))}
                </div>
                {/* Roughly, and said so. The exact split lands on the schedule
                    we email, where the remainder is put on the earliest
                    payments rather than left to rounding. */}
                <p className="text-xs text-muted-foreground">
                  About {money(Math.round(amountFor(context, option) / instalments))} a month for{" "}
                  {instalments} months.
                </p>
              </div>
            )}

            <Button
              type="button"
              variant={open || option.id === "full" ? "default" : "outline"}
              disabled={pending}
              onClick={() => {
                if (option.id === "full" || open) send(option, instalments);
                else setPicked(option);
              }}
            >
              {pending
                ? "Just a moment…"
                : option.id === "full"
                  ? `Pay ${money(amountFor(context, option))}`
                  : open
                    ? "Set this up"
                    : "Choose this"}
            </Button>
          </div>
        );
      })}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </section>
  );
}

/** Mirrors amountForPath without importing a server module into the tree. */
function amountFor(context: AcceptanceContext, option: PaymentOption): number {
  return option.keepsDiscount ? context.totalCents : context.totalCents + context.discountCents;
}
