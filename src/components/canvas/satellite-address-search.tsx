"use client";

import { useRef, useState } from "react";
import { Loader2, MapPin, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { searchAddress, type GeocodeSuggestion } from "@/lib/mapbox-geocoding";
import { isMapboxConfigured } from "@/lib/env";
import { formatCoordinates, parseCoordinates } from "@/lib/coordinates";

interface SatelliteAddressSearchProps {
  onSelect: (suggestion: GeocodeSuggestion) => void;
  disabled?: boolean;
}

export function SatelliteAddressSearch({ onSelect, disabled }: SatelliteAddressSearchProps) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<GeocodeSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleQueryChange(value: string) {
    setQuery(value);
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (!value.trim()) {
      setSuggestions([]);
      return;
    }

    // A pasted pin goes straight through without asking the geocoder, which
    // is the whole point of pasting one: the evaluator is doing this because
    // looking the address up put the photo on the wrong roof. Offered as a
    // suggestion rather than applied, so it is still one deliberate tap.
    const coordinates = parseCoordinates(value);
    if (coordinates.ok) {
      setSearching(false);
      setSuggestions([
        {
          id: "pasted-coordinates",
          fullAddress: formatCoordinates(coordinates.point),
          lat: coordinates.point.lat,
          lng: coordinates.point.lng,
        },
      ]);
      return;
    }

    debounceTimerRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        setSuggestions(await searchAddress(value));
      } catch {
        setSuggestions([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }

  function handlePick(suggestion: GeocodeSuggestion) {
    setQuery(suggestion.fullAddress);
    setSuggestions([]);
    onSelect(suggestion);
  }

  if (!isMapboxConfigured) {
    return (
      <p className="text-xs text-muted-foreground">
        Add <code>NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN</code> to <code>.env.local</code> to pull
        satellite photos by address.
      </p>
    );
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={query}
        onChange={(e) => handleQueryChange(e.target.value)}
        placeholder="Address, or paste a pin or coordinates"
        disabled={disabled}
        className="pl-9"
        autoComplete="off"
      />
      {searching && (
        <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
      )}

      {suggestions.length > 0 && (
        <div className="absolute z-10 mt-1 w-full rounded-lg border border-white/60 bg-card/85 shadow-xl backdrop-blur-xl backdrop-saturate-150">
          {suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => handlePick(s)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
            >
              <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
              {s.fullAddress}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
