"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Check, Package, Wrench, Leaf } from "lucide-react";

import { toggleLoadoutItem } from "@/lib/actions/loadout-actions";
import type { Loadout, LoadoutItem } from "@/lib/loadout";

/**
 * The shop list.
 *
 * Everything the day needs, from every stop, ticked off before the truck
 * moves. The ticks are saved as they happen, so a phone that dies in the
 * yard does not cost anyone the list.
 */
export function LoadoutPanel({ day, loadout, compact = false }: { day: string; loadout: Loadout; compact?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [items, setItem] = useOptimistic(loadout.items, (state: LoadoutItem[], next: { key: string; kind: string; checked: boolean }) =>
    state.map((i) => (i.kind === next.kind && i.key === next.key ? { ...i, checked: next.checked } : i))
  );
  const [open, setOpen] = useState(!compact);

  if (loadout.total === 0) return null;
  const done = items.filter((i) => i.checked).length;
  const complete = done === items.length;

  function tick(item: LoadoutItem) {
    setError(null);
    startTransition(async () => {
      setItem({ key: item.key, kind: item.kind, checked: !item.checked });
      const result = await toggleLoadoutItem({ day, kind: item.kind, key: item.key, checked: !item.checked });
      if (!result.ok) setError(result.message);
    });
  }

  return (
    <section
      className={`rounded-2xl border p-4 shadow-sm ${
        complete ? "border-emerald-600/40 bg-emerald-50/60" : "border-amber-500/50 bg-amber-50/60"
      }`}
    >
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-baseline justify-between gap-2 text-left">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Load at the shop</span>
        <span className={`text-sm font-semibold ${complete ? "text-emerald-800" : "text-amber-900"}`}>
          {done}/{items.length} {complete ? "loaded" : "loaded"}
        </span>
      </button>
      {open && (
        <>
          <p className="mt-1 text-sm text-muted-foreground">
            {complete ? "All on the truck. You can leave." : "Everything for every stop today. Tick each one as it goes on."}
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {items.map((item) => (
              <li key={`${item.kind}:${item.key}`}>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => tick(item)}
                  aria-pressed={item.checked}
                  className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left ${
                    item.checked ? "border-emerald-600/40 bg-white/70" : "border-border bg-background/80"
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${
                      item.checked ? "border-emerald-600 bg-emerald-600 text-white" : "border-border bg-background"
                    }`}
                  >
                    {item.checked && <Check className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-base font-semibold leading-snug">
                      <KindIcon kind={item.kind} />
                      {item.label}
                    </span>
                    {item.detail && <span className="block text-xs text-muted-foreground">{item.detail}</span>}
                    <span className="block text-xs text-muted-foreground">For {item.forStops.join(", ")}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {error && <p className="mt-2 text-sm font-medium text-destructive">{error}</p>}
        </>
      )}
    </section>
  );
}

function KindIcon({ kind }: { kind: LoadoutItem["kind"] }) {
  const cls = "h-4 w-4 text-muted-foreground";
  if (kind === "kit") return <Package className={cls} />;
  if (kind === "tool") return <Wrench className={cls} />;
  return <Leaf className={cls} />;
}
