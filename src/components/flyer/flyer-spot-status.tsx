"use client";

import { useState, useTransition } from "react";
import { CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { money } from "@/lib/flyer-offer";
import { payForFlyerSpot } from "@/lib/actions/public-flyer-actions";

/**
 * An advertiser's own booking.
 *
 * Where Stripe sends them back to, and where they land coming back to one
 * they did not finish. Nothing to fill in: either it is paid and they are on
 * the flyer, or there is one button.
 */
export function FlyerSpotStatus({
  token,
  businessName,
  imageUrl,
  status,
  amountCents,
  runName,
  mailsOn,
  flyerCount,
  justPaid,
}: {
  token: string;
  businessName: string;
  imageUrl: string;
  status: string;
  amountCents: number;
  runName: string;
  mailsOn: string | null;
  flyerCount: number;
  justPaid: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Stripe can send them back before the webhook has landed, so a fresh
  // "paid=1" is trusted for the message rather than leaving somebody who has
  // just paid looking at a Pay button.
  const settled = justPaid || status === "paid" || status === "placed";

  const mailsOnLabel = mailsOn
    ? new Date(`${mailsOn}T12:00:00Z`).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      })
    : null;

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-10 text-center">
      {imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt={`${businessName} advert`}
          className="aspect-[4/4.75] w-40 rounded-xl border border-border object-cover"
        />
      )}

      {settled ? (
        <>
          <CheckCircle2 className="h-10 w-10 text-primary" />
          <h1 className="text-2xl font-bold">You are on the flyer.</h1>
          <p className="text-muted-foreground">
            {businessName} is booked onto {runName}, going to {flyerCount.toLocaleString()} local
            homes{mailsOnLabel ? ` on ${mailsOnLabel}` : ""}. We will send a photo of the printed
            flyer when it goes out.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-bold">One step left.</h1>
          <p className="text-muted-foreground">
            {businessName} is not booked until the spot is paid for. Nobody else can have it while
            you are here, but we cannot hold it once you leave.
          </p>
          <Button
            type="button"
            size="xl"
            className="w-full"
            disabled={pending}
            onClick={() => {
              setError(null);
              start(async () => {
                const result = await payForFlyerSpot({ token });
                if (result.ok) window.location.href = result.url;
                else setError(result.message);
              });
            }}
          >
            {pending ? "Opening secure checkout…" : `Pay ${money(amountCents)}`}
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </>
      )}
    </div>
  );
}
