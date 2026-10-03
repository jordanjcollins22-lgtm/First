import { notFound } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { getOfferByCode } from "@/lib/data/offer";
import { money } from "@/lib/campaign";
import { sayExpiry } from "@/lib/data/campaign-send";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { OfferForm } from "@/components/offer/offer-form";

/**
 * Where the link in the campaign email lands.
 *
 * Their credit, when it expires, their lawn, the price, the price after
 * the credit, and one button. Nothing to type unless they want to.
 */
export const dynamic = "force-dynamic";

export default async function OfferPage({ params }: { params: Promise<{ code: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const { code } = await params;
  const offer = await getOfferByCode(code.toUpperCase());
  if (!offer) notFound();

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-6">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{offer.business.name}</p>
      <h1 className="mt-0.5 text-2xl font-semibold">
        {offer.firstName ? `${offer.firstName}, your` : "Your"} {money(offer.creditCents)} credit
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {offer.state.ok
          ? `Good until ${sayExpiry(offer.expiresOn)}. It comes off the price below when you book.`
          : offer.state.reason === "booked"
            ? "Already used. Your booking is in."
            : offer.state.reason === "expired"
              ? `This code expired on ${sayExpiry(offer.expiresOn)}.`
              : "This offer has closed."}
      </p>

      <section className="mt-5 rounded-xl border border-border bg-card p-4">
        <h2 className="text-base font-semibold">{offer.serviceLabel}</h2>
        {offer.address && <p className="mt-0.5 text-sm">{offer.address}</p>}
        {offer.price ? (
          <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Lawn, from the lot size</dt>
            <dd className="text-right tabular-nums">about {offer.price.lawnSqft.toLocaleString("en-US")} sq ft</dd>
            <dt className="text-muted-foreground">Seed</dt>
            <dd className="text-right tabular-nums">{money(offer.price.seedCents)}</dd>
            <dt className="text-muted-foreground">Crew time</dt>
            <dd className="text-right tabular-nums">{money(offer.price.laborCents)}</dd>
            <dt className="text-muted-foreground">Aerator</dt>
            <dd className="text-right tabular-nums">{money(offer.price.aeratorCents)}</dd>
            {offer.price.minimumApplied && (
              <>
                <dt className="text-muted-foreground">Minimum visit</dt>
                <dd className="text-right tabular-nums">{money(offer.price.totalCents)}</dd>
              </>
            )}
            <dt className="border-t border-border pt-1.5 text-muted-foreground">Price</dt>
            <dd className="border-t border-border pt-1.5 text-right tabular-nums">{money(offer.price.totalCents)}</dd>
            <dt className="text-muted-foreground">Your credit</dt>
            <dd className="text-right tabular-nums">- {money(offer.creditCents)}</dd>
            <dt className="text-base font-semibold">You pay</dt>
            <dd className="text-right text-base font-semibold tabular-nums">{money(offer.totalCents ?? 0)}</dd>
          </dl>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            We could not read a lot size for this address, so it books at the minimum visit, {money(offer.minimumCents)}, less your{" "}
            {money(offer.creditCents)} credit. We confirm the exact price before the visit.
          </p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          One visit: core aeration of the lawn, then seed rated for Harford County straight into the holes. Nothing to pay today.
          We confirm the date with you and invoice after the work.
        </p>
      </section>

      <div className="mt-5">
        <OfferForm code={offer.code} open={offer.state.ok} bookedJobId={offer.bookedJobId} phone={offer.business.phone} />
      </div>
    </main>
  );
}
