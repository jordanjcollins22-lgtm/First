"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { Loader2 } from "lucide-react";

import { env } from "@/lib/env";
import { markersInView } from "@/lib/actions/coverage-actions";
import {
  MARKER_ZOOM_THRESHOLD,
  STATE_COLORS,
  STATE_ORDER,
  STATE_LABELS,
  describeCoverage,
  type CoverageSummary,
} from "@/lib/coverage-map";
import type { CoverageMarker } from "@/lib/data/coverage";

if (env.mapboxToken) {
  mapboxgl.accessToken = env.mapboxToken;
}

/** Harford County, roughly, for the first frame. */
const DEFAULT_CENTER: [number, number] = [-76.3, 39.53];

/**
 * Every property, and whether anybody has spoken to it.
 *
 * The map answers one question — how much of this is still grey — so grey is
 * what an untouched property is, and the eye reads the remaining work without
 * anybody counting anything.
 *
 * Markers are fetched for the view rather than for the county. Ninety thousand
 * points is several megabytes down a phone's connection to draw a smear
 * nobody can read, and the version that refetches as it moves is both faster
 * and the only one that works from a truck.
 */
export function CoverageMapView({ summary }: { summary: CoverageSummary }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [markers, setMarkers] = useState<CoverageMarker[]>([]);
  const [tooBroad, setTooBroad] = useState(true);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async (map: mapboxgl.Map) => {
    if (map.getZoom() < MARKER_ZOOM_THRESHOLD) {
      setTooBroad(true);
      setMarkers([]);
      return;
    }
    setTooBroad(false);
    setLoading(true);
    const b = map.getBounds();
    if (!b) return;
    const rows = await markersInView({
      west: b.getWest(),
      south: b.getSouth(),
      east: b.getEast(),
      north: b.getNorth(),
    });
    setMarkers(rows);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!containerRef.current || !env.mapboxToken || mapRef.current) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/light-v11",
      center: DEFAULT_CENTER,
      zoom: 10,
    });
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl(), "top-right");

    map.on("load", () => {
      map.addSource("properties", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "properties",
        type: "circle",
        source: "properties",
        paint: {
          // Grows with zoom so a street reads as houses and a town reads as
          // density, without two layers to keep in step.
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 2.5, 14, 5, 17, 8],
          "circle-color": ["get", "color"],
          "circle-stroke-width": 0.5,
          "circle-stroke-color": "#ffffff",
          "circle-opacity": 0.9,
        },
      });
      void refresh(map);
    });

    // Only when it settles: refetching mid-drag is a request per frame.
    map.on("moveend", () => void refresh(map));

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [refresh]);

  useEffect(() => {
    const map = mapRef.current;
    const source = map?.getSource("properties") as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;
    source.setData({
      type: "FeatureCollection",
      features: markers.map((m) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [m.lng, m.lat] },
        properties: { color: STATE_COLORS[m.state] },
      })),
    });
  }, [markers]);

  if (!env.mapboxToken) {
    return (
      <p className="rounded-xl border border-white/60 bg-card/60 p-4 text-sm text-muted-foreground backdrop-blur-md">
        The coverage map needs a Mapbox token. The counts below still work without one.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <div ref={containerRef} className="h-80 w-full overflow-hidden rounded-xl border border-white/60" />
        {(tooBroad || loading) && (
          <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-xs font-medium text-white">
            {tooBroad ? (
              "Zoom in to see individual properties"
            ) : (
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading
              </span>
            )}
          </div>
        )}
        {!tooBroad && !loading && (
          <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-xs font-medium text-white">
            {markers.length.toLocaleString()} shown
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {STATE_ORDER.map((state) => (
          <span key={state} className="flex items-center gap-1.5 text-xs">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full border border-white/70"
              style={{ backgroundColor: STATE_COLORS[state] }}
            />
            {STATE_LABELS[state]}
          </span>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">{describeCoverage(summary)}</p>
    </div>
  );
}
