"use client";

import { useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  ExpressCheckoutElement,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";

import { Button } from "@/components/ui/button";

/**
 * Paying without leaving the page.
 *
 * The hosted checkout worked, but it is a redirect to somebody else's page
 * where the wallet buttons are one row among several. What a client wants is
 * the sheet their phone already has their card, name and address in, opening
 * the moment they say how they are paying.
 *
 * So the wallets come first and the card form second. Most people never
 * reach the card form, and the ones who do were never going to use Apple Pay
 * anyway.
 *
 * The publishable key is loaded once per page rather than per render:
 * loadStripe fetches a script, and calling it inside a component fetches it
 * again on every keystroke in the card form.
 */
export function PayInPlace({
  publishableKey,
  clientSecret,
  amountLabel,
  returnUrl,
}: {
  publishableKey: string;
  clientSecret: string;
  amountLabel: string;
  returnUrl: string;
}) {
  const [stripePromise] = useState(() => loadStripe(publishableKey));

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret,
        appearance: { theme: "flat", variables: { borderRadius: "12px" } },
      }}
    >
      <PayForm amountLabel={amountLabel} returnUrl={returnUrl} />
    </Elements>
  );
}

function PayForm({ amountLabel, returnUrl }: { amountLabel: string; returnUrl: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The wallet row draws nothing at all on a browser with no wallet in it, so
  // the divider above the card form would otherwise separate a heading from
  // nothing.
  const [hasWallets, setHasWallets] = useState(false);

  async function confirm() {
    if (!stripe || !elements) return;
    setError(null);
    setBusy(true);

    const submitted = await elements.submit();
    if (submitted.error) {
      setError(submitted.error.message ?? "Check the details and try again.");
      setBusy(false);
      return;
    }

    const result = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: returnUrl },
    });

    // Only a failure comes back: success has already navigated away.
    setError(result.error?.message ?? "That did not go through. Try again.");
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Apple Pay, Google Pay and Link. One tap opens the sheet with their
          card and address already in it. */}
      <ExpressCheckoutElement
        options={{ buttonHeight: 48 }}
        onReady={({ availablePaymentMethods }) =>
          setHasWallets(Boolean(availablePaymentMethods))
        }
        onConfirm={async () => {
          if (!stripe || !elements) return;
          const submitted = await elements.submit();
          if (submitted.error) {
            setError(submitted.error.message ?? "That did not go through.");
            return;
          }
          const result = await stripe.confirmPayment({
            elements,
            confirmParams: { return_url: returnUrl },
          });
          if (result.error) setError(result.error.message ?? "That did not go through.");
        }}
      />

      {hasWallets && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          or pay by card
          <span className="h-px flex-1 bg-border" />
        </p>
      )}

      <PaymentElement options={{ layout: "tabs" }} />

      <Button type="button" size="xl" className="w-full" disabled={busy} onClick={confirm}>
        {busy ? "Taking payment…" : `Pay ${amountLabel}`}
      </Button>

      {error && <p className="text-center text-sm text-destructive">{error}</p>}
    </div>
  );
}
