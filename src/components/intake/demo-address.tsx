"use client";

import { useState, useTransition } from "react";
import { Loader2, MapPin } from "lucide-react";

import { SatelliteAddressSearch } from "@/components/canvas/satellite-address-search";
import { demoLotForAddress } from "@/lib/actions/lot-actions";
import type { GeocodeSuggestion } from "@/lib/mapbox-geocoding";
import type { LotData } from "@/lib/lot-map";

export interface DemoAddress {
  address: string;
  lot: LotData | null;
}

/**
 * Not part of the client's form. An address to try the form with, so the
 * "Which parts of the property?" page shows a real lot. Clients never see
 * this: their form already knows their address.
 */
export function DemoAddressBox({ value, onChange }: { value: DemoAddress | null; onChange: (next: DemoAddress | null) => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(!value);

  function pick(suggestion: GeocodeSuggestion) {
    setError(null);
    start(async () => {
      const result = await demoLotForAddress({ lat: suggestion.lat, lng: suggestion.lng, address: suggestion.fullAddress });
      if ("error" in result) return setError(result.error);
      onChange({ address: suggestion.fullAddress, lot: result.lot });
      setEditing(false);
      if (!result.lot) setError("The county has no property line for that address (outside Harford County, or not a parcel). The form works without the map.");
    });
  }

  return (
    <section className="mb-4 rounded-xl border-2 border-dashed border-amber-500/70 bg-amber-50/70 p-3 text-sm dark:bg-amber-950/30">
      <p className="text-xs font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300">Demo only · not part of the client&apos;s form</p>
      {editing ? (
        <>
          <p className="mt-1 text-muted-foreground">
            Type any address to try the form with. It shows that property&apos;s lot on &ldquo;Which parts of the property?&rdquo;. Nothing is saved.
          </p>
          <div className="mt-2">
            <SatelliteAddressSearch onSelect={pick} disabled={pending} />
          </div>
          {pending && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Getting the lot from the county…
            </p>
          )}
        </>
      ) : (
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{value?.address}</span>
          <button type="button" className="font-medium text-primary" onClick={() => setEditing(true)}>
            Change
          </button>
          <button type="button" className="text-muted-foreground" onClick={() => onChange(null)}>
            Clear
          </button>
        </p>
      )}
      {error && <p className="mt-2 text-xs text-amber-900 dark:text-amber-200">{error}</p>}
    </section>
  );
}
