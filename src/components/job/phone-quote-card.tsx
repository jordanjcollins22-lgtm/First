import { Phone } from "lucide-react";

import { InstantPriceBreakdown } from "@/components/intake/instant-price-breakdown";
import type { InstantPrice } from "@/lib/instant-price";

const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/**
 * The call before the visit. The client has sent the pre-evaluation form,
 * with photos, and the county has the lot, so there is enough to give them
 * a general number over the phone. It is priced higher than the visit
 * would be, because nobody has seen the yard. Staff only: the client never
 * sees this card or this number unless somebody says it on the call.
 */
export function PhoneQuoteCard({ price, clientName, phone }: { price: InstantPrice; clientName: string | null; phone: string | null }) {
  const first = clientName?.trim().split(/\s+/)[0] ?? null;
  return (
    <section className="flex flex-col gap-3 rounded-xl border-2 border-dashed border-amber-500/70 bg-amber-50/70 p-4 text-sm dark:bg-amber-950/30">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300">Staff only · never shown to the client</p>
          <h2 className="text-base font-semibold">Phone quote before the visit</h2>
        </div>
        {phone && (
          <a
            href={`tel:${phone}`}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-primary px-3 font-semibold text-primary-foreground"
          >
            <Phone className="h-4 w-4" /> Call {first ?? "them"}
          </a>
        )}
      </div>

      {price.totalCents > 0 && (
        <div className="rounded-lg border border-border bg-background/70 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What to say</p>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            <li>
              &ldquo;{first ? `Hi ${first}, ` : ""}we have the photos you sent and the measurements of your property from what you filled
              out, so we can give you a general idea of the price before we come out.&rdquo;
            </li>
            <li>&ldquo;For everything you asked for, it should be around {dollars(price.totalCents)}.&rdquo;</li>
            <li>
              &ldquo;That&apos;s a little higher than it would be after a visit, because we haven&apos;t seen the yard yet. When we
              walk it with you, you get a written proposal with the exact price.&rdquo;
            </li>
          </ul>
        </div>
      )}

      <InstantPriceBreakdown price={price} />
    </section>
  );
}
