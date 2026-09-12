"use client";

import { useRef, useState, useTransition } from "react";
import { Loader2, MapPin, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PropertyConfirmDialog } from "@/components/property/property-confirm-dialog";
import { createPropertyAndJob } from "@/lib/actions/property-actions";
import { searchAddress, type GeocodeSuggestion } from "@/lib/mapbox-geocoding";
import { isMapboxConfigured } from "@/lib/env";

export function NewPropertyForm() {
  const [customerName, setCustomerName] = useState("");
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<GeocodeSuggestion[]>([]);
  const [selected, setSelected] = useState<GeocodeSuggestion | null>(null);
  const [searching, setSearching] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleQueryChange(value: string) {
    setQuery(value);
    setSelected(null);
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (!value.trim()) {
      setSuggestions([]);
      return;
    }
    debounceTimerRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await searchAddress(value);
        setSuggestions(results);
      } catch {
        setSuggestions([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!selected) {
      setError("Select an address from the search results.");
      return;
    }
    if (!customerName.trim()) {
      setError("Customer name is required.");
      return;
    }
    setConfirmOpen(true);
  }

  function handleConfirm() {
    if (!selected) return;
    startTransition(async () => {
      try {
        await createPropertyAndJob({
          customerName: customerName.trim(),
          address: selected.fullAddress,
          lat: selected.lat,
          lng: selected.lng,
        });
      } catch (err) {
        // NEXT_REDIRECT is thrown by redirect() inside the server action;
        // let it propagate so navigation actually happens.
        if (err instanceof Error && err.message === "NEXT_REDIRECT") throw err;
        setConfirmOpen(false);
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="customerName">Customer name</Label>
        <Input
          id="customerName"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          placeholder="Jane Smith"
          className="h-12 text-base"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="address">Property address</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="address"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder={isMapboxConfigured ? "123 Main St, Charlotte, NC" : "Mapbox token missing"}
            disabled={!isMapboxConfigured}
            className="h-12 pl-10 text-base"
            autoComplete="off"
          />
          {searching && (
            <Loader2 className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>

        {suggestions.length > 0 && !selected && (
          <div className="rounded-lg border border-white/60 bg-card/85 shadow-xl backdrop-blur-xl backdrop-saturate-150">
            {suggestions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setSelected(s);
                  setQuery(s.fullAddress);
                  setSuggestions([]);
                }}
                className="flex w-full items-center gap-2 px-3 py-3 text-left text-sm hover:bg-accent"
              >
                <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
                {s.fullAddress}
              </button>
            ))}
          </div>
        )}

        {selected && (
          <p className="flex items-center gap-1 text-sm text-primary">
            <MapPin className="h-4 w-4" /> {selected.fullAddress}
          </p>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" size="xl" disabled={isPending} className="w-full">
        {isPending ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" /> Creating property...
          </>
        ) : (
          "Load Satellite Map"
        )}
      </Button>

      {selected && (
        <PropertyConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          suggestion={selected}
          customerName={customerName.trim()}
          onConfirm={handleConfirm}
          isPending={isPending}
        />
      )}
    </form>
  );
}
