"use client";

import { useState, useTransition } from "react";
import { MapPin } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SatelliteAddressSearch } from "@/components/canvas/satellite-address-search";
import { createBusinessLocation } from "@/lib/actions/location-actions";
import { cn } from "@/lib/utils";
import type { GeocodeSuggestion } from "@/lib/mapbox-geocoding";

const NONE = "__none__";
const ADD_NEW = "__add_new__";

/**
 * Picks where a tool or material lives from the business locations on the
 * Project Data map, so the two stay one set of places instead of drifting
 * apart. Adding one here creates a real map location — name plus a geocoded
 * address — rather than a loose bit of text only Inventory knows about.
 */
export function StorageLocationSelect({
  locations,
  value,
  onChange,
  invalid = false,
  disabled = false,
  className,
}: {
  /** Names of the org's business locations, from the Project Data map. */
  locations: string[];
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState<GeocodeSuggestion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // A location assigned before this picker existed — or one since removed
  // from the map — still has to show as the current value rather than
  // silently reading as "Not set".
  const trimmed = value.trim();
  const options = Array.from(new Set([...locations, ...(trimmed ? [trimmed] : [])])).sort((a, b) =>
    a.localeCompare(b)
  );

  function handleSelect(next: string) {
    if (next === ADD_NEW) {
      setName("");
      setAddress(null);
      setError(null);
      setAdding(true);
      return;
    }
    onChange(next === NONE ? "" : next);
  }

  function handleCreate() {
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Name this location.");
      return;
    }
    if (!address) {
      setError("Search for and pick an address.");
      return;
    }
    startTransition(async () => {
      try {
        await createBusinessLocation({
          name: trimmedName,
          address: address.fullAddress,
          lat: address.lat,
          lng: address.lng,
        });
        onChange(trimmedName);
        setAdding(false);
        setName("");
        setAddress(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't add that location.");
      }
    });
  }

  if (adding) {
    return (
      <div className="flex w-64 flex-col gap-2 rounded-lg border border-border bg-muted/40 p-2.5">
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Location name (e.g. Main Yard)"
          disabled={isPending}
          className="h-9 text-sm"
        />
        <SatelliteAddressSearch onSelect={setAddress} disabled={isPending} />
        {address && (
          <p className="flex items-center gap-1 text-xs text-primary">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            {address.fullAddress}
          </p>
        )}
        <p className="text-[10px] text-muted-foreground">Also added to the Project Data map.</p>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={handleCreate} disabled={isPending}>
            {isPending ? "Adding..." : "Add location"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Select value={trimmed || NONE} onValueChange={handleSelect} disabled={disabled}>
      <SelectTrigger className={cn("h-9 text-sm", invalid && "border-destructive text-destructive", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{invalid ? "⚠ Add location" : "Not set"}</SelectItem>
        {options.map((location) => (
          <SelectItem key={location} value={location}>
            {location}
          </SelectItem>
        ))}
        <SelectItem value={ADD_NEW}>+ Add new location</SelectItem>
      </SelectContent>
    </Select>
  );
}
