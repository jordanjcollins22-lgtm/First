"use client";

import type { ReactNode } from "react";
import { CheckCircle2, Square, SquareCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import { addonLines, areaPick, type ProposalAddon } from "@/lib/proposal-addons";

const dollars = (cents: number) => `$${Math.round(cents / 100).toLocaleString()}`;

/**
 * Extras the client can add when they accept, like Christmas lights. Each is
 * a box to tick, with its price and what it covers. An add-on split into
 * areas (roofline, bushes...) gets one box per area instead, each with its
 * own price, so the client takes only the parts they want. Once the
 * proposal is answered, only what they added is shown, as added.
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
      {shown.map((addon) => (addon.areas ? <AreaAddon key={addon.key} addon={addon} selected={selected} onToggle={onToggle} locked={locked} /> : <WholeAddon key={addon.key} addon={addon} selected={selected} onToggle={onToggle} locked={locked} />))}
    </div>
  );
}

type Props = { addon: ProposalAddon; selected: string[]; onToggle: (key: string) => void; locked: boolean };

function Tick({ id, on, locked, onToggle, className, children }: { id: string; on: boolean; locked: boolean; onToggle: (key: string) => void; className: string; children: ReactNode }) {
  const Box = locked ? CheckCircle2 : on ? SquareCheck : Square;
  const body = (
    <>
      <Box className={cn("mt-0.5 h-6 w-6 shrink-0", on ? "text-primary" : "text-muted-foreground")} aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </>
  );
  return locked ? (
    <div className={className}>{body}</div>
  ) : (
    <button type="button" role="checkbox" aria-checked={on} className={className} onClick={() => onToggle(id)}>
      {body}
    </button>
  );
}

function WholeAddon({ addon, selected, onToggle, locked }: Props) {
  const on = locked || selected.includes(addon.key);
  return (
    <Tick
      id={addon.key}
      on={on}
      locked={locked}
      onToggle={onToggle}
      className={cn("flex w-full items-start gap-3 rounded-2xl border p-4 text-left", on ? "border-primary bg-primary/5" : "border-border")}
    >
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
    </Tick>
  );
}

function AreaAddon({ addon, selected, onToggle, locked }: Props) {
  const areas = (addon.areas ?? []).filter((a) => !locked || a.chosen);
  const ids = areas.map((a) => areaPick(addon.key, a.key));
  const picked = locked ? areas : areas.filter((a, i) => selected.includes(ids[i]));
  const pickedCents = picked.reduce((sum, a) => sum + a.priceCents, 0);
  // The area list is already the "what we decorate", so it is not repeated.
  const lines = addonLines({ ...addon, decorate: "", areas: undefined });
  return (
    <div className={cn("flex flex-col gap-2 rounded-2xl border p-4", picked.length ? "border-primary bg-primary/5" : "border-border")}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-semibold">{addon.name}</p>
        {picked.length > 0 && <p className="shrink-0 font-semibold text-primary">+{dollars(pickedCents)}</p>}
      </div>
      {!locked && <p className="text-sm text-muted-foreground">Pick the areas you want decorated. Each one has its own price.</p>}
      <div className="flex flex-col gap-2">
        {areas.map((area, i) => {
          const on = locked || selected.includes(ids[i]);
          return (
            <Tick
              key={area.key}
              id={ids[i]}
              on={on}
              locked={locked}
              onToggle={onToggle}
              className={cn("flex w-full items-start gap-3 rounded-xl border bg-background p-3 text-left", on ? "border-primary" : "border-border")}
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-medium">{area.name}</p>
                <p className="shrink-0 font-semibold text-primary">+{dollars(area.priceCents)}</p>
              </div>
            </Tick>
          );
        })}
      </div>
      {lines.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {lines.map((line) => (
            <li key={line} className="text-sm text-muted-foreground">
              {line}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
