"use client";

import { Check, Gift, Minus } from "lucide-react";

import type { ProposalOption } from "@/lib/proposal-options";
import { cn } from "@/lib/utils";

const dollars = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

/**
 * The ways the job is offered, side by side: each one's price, what it
 * includes, what it leaves out, and anything given free with it. Picking one
 * is what Accept accepts. Once accepted, only the one chosen is marked.
 */
export function OptionCards({
  options,
  selected,
  onSelect,
  locked,
}: {
  options: ProposalOption[];
  selected: string | null;
  onSelect: (key: string) => void;
  /** Already answered: the cards are a record, not a choice. */
  locked: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="text-center">
        <h2 className="text-lg font-semibold">Choose how you&apos;d like it done</h2>
        {!locked && <p className="text-sm text-muted-foreground">Tap an option, then accept it below.</p>}
      </div>
      <div className={cn("grid gap-3", options.length === 2 && "sm:grid-cols-2")}>
        {options.map((o) => {
          const on = selected === o.key;
          return (
            <button
              key={o.key}
              type="button"
              disabled={locked}
              onClick={() => onSelect(o.key)}
              aria-pressed={on}
              className={cn(
                "relative flex flex-col gap-3 rounded-2xl border-2 p-4 text-left transition-colors",
                on ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
                locked && !on && "opacity-50"
              )}
            >
              {o.recommended && (
                <span className="absolute -top-2.5 left-4 rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground">
                  Our recommendation
                </span>
              )}
              <div>
                <p className="text-base font-bold">{o.name}</p>
                {o.tagline && <p className="text-sm text-muted-foreground">{o.tagline}</p>}
              </div>
              <p className="text-3xl font-bold text-primary">{dollars(o.totalCents)}</p>
              <ul className="flex flex-col gap-1.5 text-sm">
                {o.includes.map((item) => (
                  <li key={item} className="flex gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              {o.bonus && (
                <p className="flex gap-2 rounded-lg bg-primary/10 p-2 text-sm font-medium">
                  <Gift className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>{o.bonus}</span>
                </p>
              )}
              {o.notIncluded.length > 0 && (
                <div className="border-t border-border pt-2">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Not included</p>
                  <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                    {o.notIncluded.map((item) => (
                      <li key={item} className="flex gap-2">
                        <Minus className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <span
                className={cn(
                  "mt-auto rounded-lg py-2 text-center text-sm font-semibold",
                  on ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                )}
              >
                {on ? (locked ? "Your choice" : "Selected") : "Choose this option"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
