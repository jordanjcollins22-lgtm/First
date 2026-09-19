"use client";

import { useState, useTransition } from "react";
import { MapPin, Plus, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SatelliteAddressSearch } from "@/components/canvas/satellite-address-search";
import {
  createBusinessLocation,
  createLocationArea,
  deleteBusinessLocation,
  deleteLocationArea,
} from "@/lib/actions/location-actions";
import type { BusinessLocation, LocationArea, LocationAreaGeometryType, LatLng } from "@/types/domain";
import type { GeocodeSuggestion } from "@/lib/mapbox-geocoding";

const AREA_GEOMETRY_OPTIONS: { value: LocationAreaGeometryType; label: string; hint: string }[] = [
  { value: "point_radius", label: "Address + radius", hint: "Service radius around a single point" },
  { value: "polygon", label: "Area (polygon)", hint: "A drawn service region" },
  { value: "zip_list", label: "Zip codes", hint: "Zip codes served — not plotted on the map" },
];

function NewLocationForm({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState<GeocodeSuggestion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleAdd() {
    setError(null);
    if (!name.trim()) {
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
          name: name.trim(),
          address: address.fullAddress,
          lat: address.lat,
          lng: address.lng,
        });
        setName("");
        setAddress(null);
        onAdded();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-2.5">
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Location name (e.g. Main Yard)" disabled={isPending} />
      <SatelliteAddressSearch onSelect={setAddress} />
      {address && (
        <p className="flex items-center gap-1 text-xs text-primary">
          <MapPin className="h-3.5 w-3.5" /> {address.fullAddress}
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button type="button" size="sm" variant="secondary" onClick={handleAdd} disabled={isPending} className="self-start">
        <Plus className="h-3.5 w-3.5" />
        Add location
      </Button>
    </div>
  );
}

function NewAreaForm({
  locationId,
  drawnPoints,
  onRequestDraw,
  onAdded,
}: {
  locationId: string;
  drawnPoints: LatLng[] | null;
  onRequestDraw: () => void;
  onAdded: () => void;
}) {
  const [name, setName] = useState("");
  const [geometryType, setGeometryType] = useState<LocationAreaGeometryType>("point_radius");
  const [address, setAddress] = useState<GeocodeSuggestion | null>(null);
  const [radiusMiles, setRadiusMiles] = useState("1");
  const [zipText, setZipText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleAdd() {
    setError(null);
    if (!name.trim()) {
      setError("Name this area.");
      return;
    }

    let geometry;
    if (geometryType === "point_radius") {
      if (!address) {
        setError("Search for and pick an address.");
        return;
      }
      const radius = Number(radiusMiles);
      if (!radius || radius <= 0) {
        setError("Enter a radius in miles.");
        return;
      }
      geometry = { lat: address.lat, lng: address.lng, radius_miles: radius };
    } else if (geometryType === "polygon") {
      if (!drawnPoints || drawnPoints.length < 3) {
        setError("Draw the area on the Satellite Map first.");
        return;
      }
      geometry = { points: drawnPoints };
    } else {
      const zips = zipText
        .split(/[\s,]+/)
        .map((z) => z.trim())
        .filter(Boolean);
      if (zips.length === 0) {
        setError("Enter at least one zip code.");
        return;
      }
      geometry = { zips };
    }

    startTransition(async () => {
      try {
        await createLocationArea({ locationId, name: name.trim(), geometryType, geometry, notes: null });
        onAdded();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border bg-muted/30 p-2.5">
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Area name (e.g. Core service zone)" disabled={isPending} className="h-8 text-sm" />

      <Select value={geometryType} onValueChange={(v) => setGeometryType(v as LocationAreaGeometryType)}>
        <SelectTrigger className="h-8 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {AREA_GEOMETRY_OPTIONS.map((g) => (
            <SelectItem key={g.value} value={g.value}>
              {g.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{AREA_GEOMETRY_OPTIONS.find((g) => g.value === geometryType)?.hint}</p>

      {geometryType === "point_radius" && (
        <div className="flex flex-col gap-2">
          <SatelliteAddressSearch onSelect={setAddress} />
          {address && (
            <p className="flex items-center gap-1 text-xs text-primary">
              <MapPin className="h-3.5 w-3.5" /> {address.fullAddress}
            </p>
          )}
          <div className="flex items-center gap-2">
            <Label className="text-xs">Radius (miles)</Label>
            <Input
              type="number"
              step="0.25"
              min={0}
              value={radiusMiles}
              onChange={(e) => setRadiusMiles(e.target.value)}
              className="h-8 w-24 text-sm"
            />
          </div>
        </div>
      )}

      {geometryType === "polygon" && (
        <div className="flex flex-col gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onRequestDraw}>
            {drawnPoints ? "Redraw on Satellite Map" : "Draw on Satellite Map"}
          </Button>
          <p className="text-xs text-muted-foreground">
            {drawnPoints
              ? `${drawnPoints.length} point${drawnPoints.length === 1 ? "" : "s"} captured.`
              : "Switches to Satellite View so you can click points on the map."}
          </p>
        </div>
      )}

      {geometryType === "zip_list" && (
        <Textarea
          value={zipText}
          onChange={(e) => setZipText(e.target.value)}
          placeholder="21201, 21202, 21093"
          className="h-14 text-sm"
        />
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button type="button" size="sm" variant="secondary" onClick={handleAdd} disabled={isPending} className="self-start">
        <Plus className="h-3.5 w-3.5" />
        Add area
      </Button>
    </div>
  );
}

export function ManageLocations({
  locations,
  areas,
  drawnPoints,
  onRequestDraw,
}: {
  locations: BusinessLocation[];
  areas: LocationArea[];
  drawnPoints: LatLng[] | null;
  onRequestDraw: () => void;
}) {
  const [addingAreaFor, setAddingAreaFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function run(action: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await action();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  function handleDeleteLocation(location: BusinessLocation) {
    const areaCount = areas.filter((a) => a.location_id === location.id).length;
    const warning = areaCount > 0 ? ` This also deletes ${areaCount} area${areaCount === 1 ? "" : "s"}.` : "";
    if (!window.confirm(`Delete "${location.name}"?${warning}`)) return;
    run(() => deleteBusinessLocation(location.id));
  }

  return (
    <div className="flex flex-col gap-4">
      {locations.length === 0 && (
        <p className="text-sm text-muted-foreground">No business locations yet — add your first one below.</p>
      )}

      {locations.map((location) => {
        const locationAreas = areas.filter((a) => a.location_id === location.id);
        return (
          <div key={location.id} className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="flex items-center gap-1.5 text-sm font-semibold">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400" aria-hidden />
                  {location.name}
                </p>
                {location.address && <p className="text-xs text-muted-foreground">{location.address}</p>}
              </div>
              <button
                type="button"
                onClick={() => handleDeleteLocation(location)}
                disabled={isPending}
                aria-label={`Delete ${location.name}`}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>

            {locationAreas.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {locationAreas.map((area) => (
                  <div key={area.id} className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2.5 py-1.5 text-xs">
                    <span>
                      {area.name}{" "}
                      <span className="text-muted-foreground">
                        · {AREA_GEOMETRY_OPTIONS.find((g) => g.value === area.geometry_type)?.label ?? area.geometry_type}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => run(() => deleteLocationArea(area.id))}
                      disabled={isPending}
                      aria-label={`Remove ${area.name}`}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {addingAreaFor === location.id ? (
              <NewAreaForm
                locationId={location.id}
                drawnPoints={drawnPoints}
                onRequestDraw={onRequestDraw}
                onAdded={() => setAddingAreaFor(null)}
              />
            ) : (
              <Button type="button" variant="ghost" size="sm" onClick={() => setAddingAreaFor(location.id)} className="self-start">
                <Plus className="h-3.5 w-3.5" />
                Add area
              </Button>
            )}
          </div>
        );
      })}

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="border-t border-border pt-3">
        <NewLocationForm onAdded={() => {}} />
      </div>
    </div>
  );
}
