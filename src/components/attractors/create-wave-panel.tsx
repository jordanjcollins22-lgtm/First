"use client";

import { useMemo, useState, useTransition } from "react";
import { Loader2, MapPin } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SatelliteAddressSearch } from "@/components/canvas/satellite-address-search";
import { createAttractorWave } from "@/lib/actions/attractor-actions";
import type {
  AttractorGeometry,
  AttractorGeometryType,
  AttractorType,
  AttractorVariant,
  AttractorWaveStatus,
  LatLng,
} from "@/types/domain";
import type { GeocodeSuggestion } from "@/lib/mapbox-geocoding";
import { AreaCoveragePanel } from "./area-coverage-panel";
import type { AreaAddress } from "@/lib/area-coverage";

const GEOMETRY_OPTIONS: { value: AttractorGeometryType; label: string; hint: string }[] = [
  { value: "point_radius", label: "Address + radius", hint: "Yard sign, billboard, single location" },
  { value: "polygon", label: "Area (polygon)", hint: "Neighborhood, door-hanger route area" },
  { value: "route", label: "Route (line)", hint: "Vehicle route, driving path" },
  { value: "zip_list", label: "Zip codes", hint: "Digital ads targeted by zip — not plotted on the map" },
];

export function CreateWavePanel({
  types,
  variants,
  drawnPoints,
  onRequestDraw,
  areaAddresses,
  onCancel,
  onCreated,
}: {
  types: AttractorType[];
  variants: AttractorVariant[];
  drawnPoints: LatLng[] | null;
  onRequestDraw: (geometryType: "polygon" | "route") => void;
  /** Every address on file, for counting doors inside the shape being drawn. */
  areaAddresses: AreaAddress[];
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [variantId, setVariantId] = useState<string>("");
  const [name, setName] = useState("");
  const [geometryType, setGeometryType] = useState<AttractorGeometryType>("point_radius");
  const [address, setAddress] = useState<GeocodeSuggestion | null>(null);
  const [radiusMiles, setRadiusMiles] = useState("0.25");
  const [bufferMiles, setBufferMiles] = useState("0.25");
  const [zipText, setZipText] = useState("");
  const [datePlanned, setDatePlanned] = useState("");
  const [status, setStatus] = useState<AttractorWaveStatus>("planned");
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const availableVariants = useMemo(() => variants.filter((v) => v.type_id === typeId), [variants, typeId]);

  /**
   * The area as the form currently describes it.
   *
   * One builder for both the live door count and the save, so the number
   * somebody reads before pressing the button is the number for the shape that
   * actually gets saved.
   */
  function buildGeometry(): { geometry: AttractorGeometry } | { error: string } {
    if (geometryType === "point_radius") {
      if (!address) return { error: "Search for and pick an address." };
      const radius = Number(radiusMiles);
      if (!radius || radius <= 0) return { error: "Enter a radius in miles." };
      return { geometry: { lat: address.lat, lng: address.lng, radius_miles: radius } };
    }
    if (geometryType === "polygon") {
      if (!drawnPoints || drawnPoints.length < 3) {
        return { error: "Draw the area on the Satellite Map first." };
      }
      return { geometry: { points: drawnPoints } };
    }
    if (geometryType === "route") {
      if (!drawnPoints || drawnPoints.length < 2) {
        return { error: "Draw the route on the Satellite Map first." };
      }
      const buffer = Number(bufferMiles);
      return { geometry: { points: drawnPoints, buffer_miles: buffer > 0 ? buffer : 0.1 } };
    }
    const zips = zipText
      .split(/[\s,]+/)
      .map((z) => z.trim())
      .filter(Boolean);
    if (zips.length === 0) return { error: "Enter at least one zip code." };
    return { geometry: { zips } };
  }

  const built = buildGeometry();
  const previewGeometry = "geometry" in built ? built.geometry : null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Name this wave.");
      return;
    }
    if (!typeId) {
      setError("Pick a type.");
      return;
    }

    const built = buildGeometry();
    if ("error" in built) {
      setError(built.error);
      return;
    }
    const geometry = built.geometry;

    startTransition(async () => {
      try {
        await createAttractorWave({
          typeId,
          variantId: variantId || null,
          name: name.trim(),
          geometryType,
          geometry,
          datePlanned: datePlanned || null,
          status,
          quantityDeployed: quantity.trim() ? Number(quantity) : null,
          notes: notes.trim() || null,
        });
        onCreated();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wave-name">Wave name</Label>
        <Input
          id="wave-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Spring door hangers — Oakwood"
        />
      </div>

      <div className="flex gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label>Type</Label>
          <Select
            value={typeId}
            onValueChange={(v) => {
              setTypeId(v);
              setVariantId("");
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {types.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label>Variant</Label>
          <Select value={variantId} onValueChange={setVariantId}>
            <SelectTrigger>
              <SelectValue placeholder="Optional" />
            </SelectTrigger>
            <SelectContent>
              {availableVariants.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Coverage</Label>
        <Select
          value={geometryType}
          onValueChange={(v) => setGeometryType(v as AttractorGeometryType)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GEOMETRY_OPTIONS.map((g) => (
              <SelectItem key={g.value} value={g.value}>
                {g.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {GEOMETRY_OPTIONS.find((g) => g.value === geometryType)?.hint}
        </p>
      </div>

      {geometryType === "point_radius" && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-2.5">
          <SatelliteAddressSearch onSelect={setAddress} />
          {address && (
            <p className="flex items-center gap-1 text-xs text-primary">
              <MapPin className="h-3.5 w-3.5" /> {address.fullAddress}
            </p>
          )}
          <div className="flex items-center gap-2">
            <Label htmlFor="wave-radius" className="text-xs">
              Radius (miles)
            </Label>
            <Input
              id="wave-radius"
              type="number"
              step="0.05"
              min={0}
              value={radiusMiles}
              onChange={(e) => setRadiusMiles(e.target.value)}
              className="h-8 w-24 text-sm"
            />
          </div>
        </div>
      )}

      {(geometryType === "polygon" || geometryType === "route") && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-2.5">
          <Button type="button" variant="secondary" size="sm" onClick={() => onRequestDraw(geometryType)}>
            {drawnPoints ? "Redraw on Satellite Map" : "Draw on Satellite Map"}
          </Button>
          <p className="text-xs text-muted-foreground">
            {drawnPoints
              ? `${drawnPoints.length} point${drawnPoints.length === 1 ? "" : "s"} captured.`
              : "Switches to Satellite View so you can click points on the map."}
          </p>
          {geometryType === "route" && (
            <div className="flex items-center gap-2">
              <Label htmlFor="wave-buffer" className="text-xs">
                Route width (miles)
              </Label>
              <Input
                id="wave-buffer"
                type="number"
                step="0.05"
                min={0}
                value={bufferMiles}
                onChange={(e) => setBufferMiles(e.target.value)}
                className="h-8 w-24 text-sm"
              />
            </div>
          )}
        </div>
      )}

      {geometryType === "zip_list" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="wave-zips">Zip codes</Label>
          <Textarea
            id="wave-zips"
            value={zipText}
            onChange={(e) => setZipText(e.target.value)}
            placeholder="21201, 21202, 21093"
            className="h-16 text-sm"
          />
        </div>
      )}

      <div className="flex gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="wave-date-planned">Date planned</Label>
          <Input id="wave-date-planned" type="date" value={datePlanned} onChange={(e) => setDatePlanned(e.target.value)} />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="wave-quantity">Quantity</Label>
          <Input
            id="wave-quantity"
            type="number"
            step="1"
            min={0}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="e.g. 200"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Status</Label>
        <Select value={status} onValueChange={(v) => setStatus(v as AttractorWaveStatus)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="planned">Planned</SelectItem>
            <SelectItem value="ready">Ready</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wave-notes">Notes</Label>
        <Textarea id="wave-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="h-16 text-sm" />
      </div>

      {/* Live, as the shape is drawn. The moment the door count changes a
          decision is the moment somebody is deciding how big to make the
          circle — showing it only after saving is showing it too late. */}
      <AreaCoveragePanel type={geometryType} geometry={previewGeometry} addresses={areaAddresses} />

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Creating...
            </>
          ) : (
            "Create wave"
          )}
        </Button>
      </div>
    </form>
  );
}
