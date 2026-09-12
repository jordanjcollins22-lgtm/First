"use client";

import { useState, useTransition } from "react";
import { Loader2, MapPin } from "lucide-react";

import { Button } from "@/components/ui/button";
import { geocodeImportedAddresses } from "@/lib/actions/geocode-actions";

/**
 * Putting imported addresses on the map.
 *
 * An imported contact carries its address as text, because a property needs
 * real coordinates and a CRM address often will not resolve to any. Until this
 * runs, those contacts appear nowhere that draws a map — which is exactly the
 * "why can't I see my contacts on Project Data" that sends somebody hunting
 * for a bug that is really a step nobody has taken yet.
 *
 * So the step is a button that says how many are waiting, rather than
 * something that happens invisibly and is either done or not.
 */
export function GeocodePanel({ pending, failed }: { pending: number; failed: number }) {
  const [left, setLeft] = useState(pending);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (left === 0 && failed === 0 && !status) return null;

  function run() {
    setError(null);
    startTransition(async () => {
      const result = await geocodeImportedAddresses();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setLeft(result.remaining);
      setStatus(result.message);
    });
  }

  return (
    <section className="rounded-xl border border-primary/40 bg-primary/5 p-4">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold">
        <MapPin className="h-4 w-4" />
        Put imported addresses on the map
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Imported contacts keep their address as text until it is looked up. Until then they have no
        property, so they don&apos;t show on Project Data or the coverage map. This does the lookups.
      </p>

      {left > 0 && (
        <p className="mt-2 text-sm font-medium">
          {left.toLocaleString()} {left === 1 ? "address is" : "addresses are"} waiting.
        </p>
      )}
      {failed > 0 && (
        <p className="mt-1 text-xs text-amber-800">
          {failed} couldn&apos;t be found — usually a partial address like &ldquo;Bel Air, MD&rdquo; with no
          street. Those need editing by hand.
        </p>
      )}

      {status && <p className="mt-1 text-xs font-medium text-emerald-700">{status}</p>}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}

      {left > 0 && (
        <Button type="button" size="sm" className="mt-2" onClick={run} disabled={isPending}>
          {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {isPending ? "Looking them up…" : `Place the next ${Math.min(40, left)}`}
        </Button>
      )}

      {/* Said plainly, because a run of forty out of three thousand looks like
          it did not work unless somebody knows to press it again. */}
      {left > 40 && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Forty at a time, so a run finishes rather than timing out. Keep tapping until it says all done.
        </p>
      )}
    </section>
  );
}
