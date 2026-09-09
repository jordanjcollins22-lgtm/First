"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { Loader2 } from "lucide-react";

import { env } from "@/lib/env";
import type { ZoneHouse } from "@/app/api/marketing/[playId]/zone-houses/route";

if (env.mapboxToken) {
  mapboxgl.accessToken = env.mapboxToken;
}

/**
 * The round, on a map, with every house in the zone on it.
 *
 * Editing a round used to be a list of the doors it already had, with a tick
 * box against each — so the only edit anybody could make was to shrink it.
 * The four houses round the corner that obviously belong to the same walk were
 * not on the list, because they were not on the round, which is exactly why
 * somebody wanted to add them.
 *
 * So: every house in the zone is drawn. Filled ones are on the round, hollow
 * ones are not, and a tap flips either. That is the whole interaction.
 *
 * Drawn as one GeoJSON layer rather than four hundred markers. A marker is a
 * DOM node, and four hundred of them on a phone is a map that will not pan.
 */
export function RouteHousePicker({
  houses,
  on,
  onToggle,
}: {
  houses: ZoneHouse[];
  /** The ids currently on the round, after the edits made so far. */
  on: Set<string>;
  onToggle: (houseId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [ready, setReady] = useState(false);

  // The callback and the selection are read from refs inside the map's own
  // event handler, which is registered once. Without this the handler closes
  // over the first render's props and every tap after the first is ignored.
  const onRef = useRef(on);
  const toggleRef = useRef(onToggle);
  onRef.current = on;
  toggleRef.current = onToggle;

  useEffect(() => {
    if (!containerRef.current || mapRef.current || !env.mapboxToken || houses.length === 0) return;

    const bounds = new mapboxgl.LngLatBounds();
    for (const house of houses) bounds.extend([house.lng, house.lat]);

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      bounds,
      fitBoundsOptions: { padding: 36 },
    });
    mapRef.current = map;

    map.on("load", () => {
      map.addSource("houses", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "houses",
        type: "circle",
        source: "houses",
        paint: {
          "circle-radius": ["case", ["get", "on"], 6, 4],
          "circle-color": ["case", ["get", "on"], "#2f6d3c", "#ffffff"],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": ["case", ["get", "on"], "#1c4526", "#94a3b8"],
        },
      });

      map.on("click", "houses", (event) => {
        const id = event.features?.[0]?.properties?.id;
        if (typeof id === "string") toggleRef.current(id);
      });
      map.on("mouseenter", "houses", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "houses", () => {
        map.getCanvas().style.cursor = "";
      });

      setReady(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, [houses]);

  // Redrawn whenever the selection changes, so a tap is visible immediately
  // rather than after a save.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource("houses") as mapboxgl.GeoJSONSource | undefined;
    source?.setData({
      type: "FeatureCollection",
      features: houses.map((house) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [house.lng, house.lat] },
        properties: { id: house.id, address: house.address, on: on.has(house.id) },
      })),
    });
  }, [houses, on, ready]);

  if (!env.mapboxToken) {
    return <p className="text-xs text-muted-foreground">The map needs a Mapbox key before doors can be picked on it.</p>;
  }

  return (
    <div className="relative overflow-hidden rounded-lg border border-border">
      <div ref={containerRef} className="h-72 w-full" />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/40">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}
      <p className="border-t border-border bg-card px-2 py-1.5 text-[11px] text-muted-foreground">
        Tap a house to put it on the round or take it off. Filled means it&apos;s on.
      </p>
    </div>
  );
}
