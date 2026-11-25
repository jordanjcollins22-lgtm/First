"use client";

import { CheckCircle2, Square, SquareCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import { addonLines, type ProposalAddon } from "@/lib/proposal-addons";

const dollars = (cents: number) => `$${Math.round(cents / 100).toLocaleString()}`;

/**
 * Extras the client can add when they accept, like Christmas lights. Each is
 * a box to tick, with its price and what it covers. Once the proposal is
 * answered, only the ones they added are shown, as added.
 */
export function AddonPicker({
  addons,
  selected,
  onToggle,
  locked,
}: {
  addons: ProposalAddon[];
  selected: string[];
  onToggle: (key: string) => void;
  locked: boolean;
}) {
  const shown = locked ? addons.filter((a) => a.chosen) : addons;
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{locked ? "Added to your proposal" : "Add to your proposal"}</h2>
      {shown.map((addon) => {
        const on = locked || selected.includes(addon.key);
        const Box = locked ? CheckCircle2 : on ? SquareCheck : Square;
        const body = (
          <>
            <Box className={cn("mt-0.5 h-6 w-6 shrink-0", on ? "text-primary" : "text-muted-foreground")} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-semibold">{addon.name}</p>
                <p className="shrink-0 font-semibold text-primary">+{dollars(addon.priceCents)}</p>
              </div>
              <ul className="mt-1 flex flex-col gap-0.5">
                {addonLines(addon).map((line) => (
                  <li key={line} className="text-sm text-muted-foreground">
                    {line}
                  </li>
                ))}
              </ul>
              {!locked && <p className="mt-2 text-xs text-muted-foreground">{on ? "Added. Tap to remove." : "Tap to add it."}</p>}
            </div>
          </>
        );
        const frame = cn("flex w-full items-start gap-3 rounded-2xl border p-4 text-left", on ? "border-primary bg-primary/5" : "border-border");
        return locked ? (
          <div key={addon.key} className={frame}>
            {body}
          </div>
        ) : (
          <button key={addon.key} type="button" role="checkbox" aria-checked={on} className={frame} onClick={() => onToggle(addon.key)}>
            {body}
          </button>
        );
      })}
    </div>
  );
}
