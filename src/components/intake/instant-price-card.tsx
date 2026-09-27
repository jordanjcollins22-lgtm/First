"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { demoInstantPrice } from "@/lib/actions/instant-price-actions";
import { INTAKE_QUESTIONS, type IntakeAnswers } from "@/lib/evaluation-intake";
import { UNSEEN_PREMIUM, type InstantPrice } from "@/lib/instant-price";
import type { LotData } from "@/lib/lot-map";

const LABEL = new Map((INTAKE_QUESTIONS[0].options ?? []).map((o) => [o.value, o.label]));
const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

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
      <p className="text-xs font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300">Demo only · instant price, not shown to clients</p>
      {result === null ? (
        <p className="mt-2 flex items-center gap-1.5 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Pricing it from the rate card…
        </p>
      ) : typeof result === "string" ? (
        <p className="mt-2">{result}</p>
      ) : (
        <>
          <p className="mt-2 text-2xl font-bold">{result.totalCents > 0 ? dollars(result.totalCents) : "Priced at the visit"}</p>
          <p className="text-xs text-muted-foreground">
            Includes {Math.round(UNSEEN_PREMIUM * 100)}% because the yard has not been seen. Sizes from {result.basis} and the parts of the yard picked.
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {result.lines.map((line) => (
              <li key={line.service} className="flex justify-between gap-3">
                <span>
                  {LABEL.get(line.service) ?? line.service}
                  {line.assumed && <span className="text-muted-foreground"> · {line.assumed}</span>}
                </span>
                <span className="shrink-0 tabular-nums">{line.priceCents != null ? dollars(line.priceCents) : "At the visit"}</span>
              </li>
            ))}
            {result.premiumCents > 0 && (
              <li className="flex justify-between gap-3 border-t border-border pt-1 text-muted-foreground">
                <span>Unseen-property premium, rounded</span>
                <span className="tabular-nums">{dollars(result.premiumCents)}</span>
              </li>
            )}
          </ul>
        </>
      )}
    </section>
  );
}
