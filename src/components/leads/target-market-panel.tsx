"use client";

import { useState, useTransition } from "react";
import { Loader2, MapPinned, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  deleteTargetMarket,
  markTargetMarkets,
  saveTargetMarket,
} from "@/lib/actions/target-market-actions";
import type { TargetMarket } from "@/lib/target-market";

/**
 * Where we actually work, and who is outside it.
 *
 * "Our market is Harford County" is something everybody in the business knows
 * and nothing in the app did, so an import lands with Baltimore, Cecil and
 * half of Pennsylvania mixed in and the only way to tell was to recognise the
 * town.
 *
 * Editable rather than fixed, because the answer changes: a business that
 * takes on a second crew takes on a second county, and the version where that
 * means a code change is the version where it never gets recorded.
 */
export function TargetMarketPanel({
  markets,
  outOfMarket,
  setupNeeded,
}: {
  markets: TargetMarket[];
  /** How many are already marked as outside, so the panel can say what the
   * last check found rather than only offering to run another. */
  outOfMarket: number;
  setupNeeded: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function check() {
    setError(null);
    setStatus(null);
    startTransition(async () => {
      const result = await markTargetMarkets();
      if (result.ok) setStatus(result.message);
      else setError(result.message);
    });
  }

  if (setupNeeded) {
    return (
      <section className="mb-6 rounded-xl border border-amber-400/60 bg-amber-50/60 p-4 text-sm">
        Target markets need their database migration. Run{" "}
        <code>supabase/migrations/0092_target_markets.sql</code> in Supabase, then reload.
      </section>
    );
  }

  return (
    <section className="mb-6 rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-lg font-bold">
          <MapPinned className="h-4 w-4" />
          Our market
        </h2>
        <Button type="button" size="sm" variant="outline" onClick={check} disabled={isPending}>
          {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Check everyone
        </Button>
      </div>

      <p className="mb-3 text-xs text-muted-foreground">
        Where we actually work. Anybody outside it gets marked — not dropped. Somebody on the wrong side of
        the county line still knows a neighbour on the right side, and that call is free.
      </p>

      {outOfMarket > 0 && (
        <p className="mb-2 text-sm font-medium">
          {outOfMarket.toLocaleString()} marked outside our market.
        </p>
      )}
      {status && <p className="mb-2 text-xs font-medium text-emerald-700">{status}</p>}
      {error && <p className="mb-2 text-xs text-destructive">{error}</p>}

      <ul className="mb-2 flex flex-col gap-1.5">
        {markets.map((market) =>
          editing === market.id ? (
            <li key={market.id}>
              <MarketForm market={market} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <li
              key={market.id}
              className="flex items-start justify-between gap-2 rounded-lg border border-border bg-background/60 p-2.5"
            >
              <div className="min-w-0">
                <p className="font-medium">
                  {market.name}
                  {!market.active && <span className="ml-1.5 text-xs text-muted-foreground">(off)</span>}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {market.zips.length} zip{market.zips.length === 1 ? "" : "s"} · {market.cities.length} town
                  {market.cities.length === 1 ? "" : "s"}
                  {market.counties.length > 0 && ` · ${market.counties.join(", ")}`}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(market.id)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => {
                    if (!window.confirm(`Remove "${market.name}"?`)) return;
                    startTransition(() => deleteTargetMarket(market.id).then(() => {}));
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </li>
          )
        )}
      </ul>

      {adding ? (
        <MarketForm market={null} onDone={() => setAdding(false)} />
      ) : (
        <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)}>
          <Plus className="h-3.5 w-3.5" />
          Add an area
        </Button>
      )}
    </section>
  );
}

function MarketForm({ market, onDone }: { market: TargetMarket | null; onDone: () => void }) {
  const [name, setName] = useState(market?.name ?? "");
  const [zips, setZips] = useState((market?.zips ?? []).join(", "));
  const [cities, setCities] = useState((market?.cities ?? []).join(", "));
  const [counties, setCounties] = useState((market?.counties ?? []).join(", "));
  const [active, setActive] = useState(market?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveTargetMarket(market?.id ?? null, { name, zips, cities, counties, active });
      if (result.ok) onDone();
      else setError(result.message);
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9 text-sm" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Zip codes</Label>
        <Textarea value={zips} onChange={(e) => setZips(e.target.value)} className="h-16 text-xs" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Towns</Label>
        <Textarea value={cities} onChange={(e) => setCities(e.target.value)} className="h-16 text-xs" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Counties</Label>
        <Input value={counties} onChange={(e) => setCounties(e.target.value)} className="h-9 text-sm" />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Separate with commas or new lines. A zip is exact and matches first; a town has to be its own part
        of the address, so &ldquo;Main Street&rdquo; never counts as the town of Street.
      </p>
      <Label className="flex items-center gap-1.5 text-xs">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-3.5 w-3.5" />
        In use
      </Label>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={save} disabled={isPending}>
          {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone} disabled={isPending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
