"use client";

import { useMemo, useState } from "react";

import type { PricingEquation, ProductionService } from "@/lib/forward-pricing";
import { costToday, installedPriceCents, nativeLabel, onSale, plantPriceCents, type PlantRow } from "@/lib/plant-pricing";
import { cn } from "@/lib/utils";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** Today, in the business's day, as YYYY-MM-DD, to compare with a sale's last day. */
function today(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/**
 * The nurseries' plants this week, searchable: the size, what one costs us
 * today, what we charge for the plant and for it planted, and how many are
 * there. Plants with none available are hidden unless asked for.
 */
export function PlantAvailability({
  plants,
  ready,
  equation,
  services,
}: {
  plants: PlantRow[];
  ready: boolean;
  equation: PricingEquation;
  services: ProductionService[];
}) {
  const [query, setQuery] = useState("");
  const [nativeOnly, setNativeOnly] = useState(false);
  const [showNone, setShowNone] = useState(false);
  const [size, setSize] = useState("");
  const day = today();

  const sizes = useMemo(() => [...new Set(plants.map((p) => p.size))].sort(), [plants]);
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return plants.filter((p) => {
      if (!showNone && p.available <= 0) return false;
      if (nativeOnly && !nativeLabel(p.native)) return false;
      if (size && p.size !== size) return false;
      const text = `${p.name} ${p.category ?? ""} ${p.program ?? ""} ${p.condition ?? ""}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }, [plants, query, nativeOnly, showNone, size]);

  const week = plants[0]?.weekOf;
  const saleUntil = plants.find((p) => p.saleUntil && onSale(p, day))?.saleUntil;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 pb-16">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Plant availability</h1>
        <p className="text-sm text-muted-foreground">
          What the nurseries have{week ? ` for the week of ${week}` : ""}. Our cost is the sale price while it holds. Price is the plant on its own, marked up like
          any material; planted adds the crew&apos;s time to plant it.
          {saleUntil ? ` Sale prices hold through ${saleUntil}.` : ""}
        </p>
      </header>

      {!ready && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          The plant list isn&apos;t set up yet. Run migration 0354.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          id="plant-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search plants"
          className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
        />
        <select id="plant-size" value={size} onChange={(e) => setSize(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
          <option value="">All sizes</option>
          {sizes.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <label className="inline-flex items-center gap-1.5 text-sm">
          <input id="plant-native" type="checkbox" checked={nativeOnly} onChange={(e) => setNativeOnly(e.target.checked)} /> Native
        </label>
        <label className="inline-flex items-center gap-1.5 text-sm">
          <input id="plant-none" type="checkbox" checked={showNone} onChange={(e) => setShowNone(e.target.checked)} /> Show none available
        </label>
      </div>

      <p className="text-xs text-muted-foreground">
        {shown.length.toLocaleString("en-US")} of {plants.length.toLocaleString("en-US")} plants
      </p>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b border-border">
              <th className="px-3 py-2 font-medium">Plant</th>
              <th className="px-3 py-2 font-medium">Size</th>
              <th className="px-3 py-2 text-right font-medium">Our cost</th>
              <th className="px-3 py-2 text-right font-medium">Price</th>
              <th className="px-3 py-2 text-right font-medium">Planted</th>
              <th className="px-3 py-2 text-right font-medium">Available</th>
              <th className="px-3 py-2 font-medium">Condition</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => {
              const cost = costToday(p, day);
              const sale = onSale(p, day);
              const planted = installedPriceCents(cost, p.size, equation, services);
              const native = nativeLabel(p.native);
              return (
                <tr key={p.id} className={cn("border-b border-border last:border-0", p.available <= 0 && "opacity-60")}>
                  <td className="px-3 py-2">
                    <span className="block font-medium">{p.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {[native, p.hardy === "NH" ? "Not hardy here" : null, p.category, p.program, p.supplier].filter(Boolean).join(" · ")}
                    </span>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{p.size}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {money(cost)}
                    {sale && <span className="block text-xs text-muted-foreground line-through">{money(p.costCents)}</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(plantPriceCents(cost, equation))}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{planted != null ? money(planted) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.available.toLocaleString("en-US")}</td>
                  <td className="px-3 py-2 text-xs">{p.condition ?? ""}</td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No plants match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
