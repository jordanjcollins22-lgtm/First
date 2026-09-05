"use client";

import { DENSITY_MODES, valuePerAddress, type DensityCell, type DensityMode } from "@/lib/area-density";

function money(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

/**
 * Where to go next, ranked.
 *
 * Two questions that look like one. "Where are most of our addresses" tells
 * you where a street is walkable. "Where did the money come from" tells you
 * which street to walk first, and the two answers are routinely different
 * because the densest part of a county is usually the part with the smallest
 * lots.
 *
 * The per-address figure is on every row for that reason: it is what separates
 * an area that is dense with work from one that is merely dense with houses.
 */
export function DensityPanel({
  mode,
  onModeChange,
  cells,
}: {
  mode: DensityMode | null;
  onModeChange: (mode: DensityMode | null) => void;
  cells: DensityCell[];
}) {
  return (
    <section className="rounded-xl border border-white/60 bg-card/60 p-3 backdrop-blur-md">
      <h3 className="mb-1 text-sm font-semibold">Rank areas</h3>

      <div className="mb-2 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => onModeChange(null)}
          className={`min-h-8 rounded-full border px-3 text-xs font-medium ${
            mode === null ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent/50"
          }`}
        >
          Off
        </button>
        {DENSITY_MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            onClick={() => onModeChange(m.value)}
            className={`min-h-8 rounded-full border px-3 text-xs font-medium ${
              mode === m.value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border hover:bg-accent/50"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === null ? (
        <p className="text-xs text-muted-foreground">
          Pick one to shade the map and list the top areas. Addresses tells you where a street is worth
          walking; paid work tells you which one to walk first.
        </p>
      ) : (
        <>
          <p className="mb-2 text-xs text-muted-foreground">
            {DENSITY_MODES.find((m) => m.value === mode)?.blurb}
          </p>

          {cells.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {mode === "paid"
                ? "No collected money against any address yet."
                : "No addresses with a position yet — place them on the Contacts page first."}
            </p>
          ) : (
            <ol className="flex flex-col gap-1">
              {cells.map((cell, i) => (
                <li
                  key={cell.key}
                  className="flex items-baseline justify-between gap-2 rounded-lg border border-border bg-background/60 px-2.5 py-1.5"
                >
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="w-4 shrink-0 text-xs font-bold tabular-nums text-muted-foreground">
                      {i + 1}
                    </span>
                    <span className="truncate text-sm font-medium">{cell.area}</span>
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {mode === "paid" ? (
                      <>
                        {money(cell.collected)} · {cell.jobs} job{cell.jobs === 1 ? "" : "s"}
                      </>
                    ) : (
                      <>
                        {cell.count} address{cell.count === 1 ? "" : "es"}
                        {cell.collected > 0 && ` · ${money(valuePerAddress(cell))}/ea`}
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )}

          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Areas are about half a mile across — roughly a morning of knocking. The numbers on the map
            match this list.
          </p>
        </>
      )}
    </section>
  );
}
