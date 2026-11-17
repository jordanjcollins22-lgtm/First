"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { demoInstantPrice } from "@/lib/actions/instant-price-actions";
import type { IntakeAnswers } from "@/lib/evaluation-intake";
import type { InstantPrice } from "@/lib/instant-price";
import { InstantPriceBreakdown } from "@/components/intake/instant-price-breakdown";
import type { LotData } from "@/lib/lot-map";

/**
 * What an instant price would have said for these answers, before anybody
 * has seen the yard. Demo only, and marked so: clients never see it.
 */
export function InstantPriceCard({ answers, lot }: { answers: IntakeAnswers; lot: LotData | null }) {
  const [result, setResult] = useState<InstantPrice | string | null>(null);

  useEffect(() => {
    let current = true;
    demoInstantPrice(answers, lot ? { lotSqft: lot.lotSqft, structureSqft: lot.structureSqft } : null)
      .then((r) => current && setResult("error" in r ? r.error : r.price))
      .catch(() => current && setResult("Couldn't work out a price."));
    return () => {
      current = false;
    };
  }, [answers, lot]);

  return (
    <section className="w-full rounded-xl border-2 border-dashed border-amber-500/70 bg-amber-50/70 p-4 text-left text-sm dark:bg-amber-950/30">
      <p className="text-xs font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300">Staff only · phone quote, never shown to clients</p>
      {result === null ? (
        <p className="mt-2 flex items-center gap-1.5 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Pricing it from the rate card…
        </p>
      ) : typeof result === "string" ? (
        <p className="mt-2">{result}</p>
      ) : (
        <div className="mt-2">
          <InstantPriceBreakdown price={result} />
        </div>
      )}
    </section>
  );
}
