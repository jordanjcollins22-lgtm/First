import Link from "next/link";
import { Banknote, ChevronRight } from "lucide-react";

import type { PaymentToCollect } from "@/lib/data/collections";
import { dateShort } from "@/lib/time-zone";

/**
 * Money waiting in somebody's kitchen.
 *
 * A client who chose cash or check has decided to pay and is waiting for us
 * to come and get it. That is the easiest money in the business and the
 * easiest to forget, so it sits at the top of the day until it is marked
 * picked up.
 */
export function CollectPanel({ lines }: { lines: PaymentToCollect[] }) {
  if (lines.length === 0) return null;
  const total = lines.reduce((sum, l) => sum + l.amount, 0);
  return (
    <section className="rounded-xl border border-amber-400/50 bg-amber-400/10 p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Banknote className="h-4 w-4" />
          To collect
        </h2>
        <p className="text-sm font-semibold tabular-nums">${Math.round(total).toLocaleString()}</p>
      </div>
      <ul className="divide-y divide-amber-400/30">
        {lines.map((l) => (
          <li key={l.invoiceId}>
            <Link href={`/jobs/${l.jobId}?tab=invoice`} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {l.clientName} · ${Math.round(l.amount).toLocaleString()} by {l.method}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {l.address ?? "No address on file"}
                  {l.phone ? ` · ${l.phone}` : ""}
                  {l.requestedAt ? ` · asked ${dateShort(l.requestedAt)}` : ""}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">Open the job and press &ldquo;Mark picked up&rdquo; on the invoice once you have it.</p>
    </section>
  );
}
