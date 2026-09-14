"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

import { publicEnv } from "@/lib/public-env";

if (publicEnv.mapboxToken) {
  mapboxgl.accessToken = publicEnv.mapboxToken;
}

export interface CrewDot {
  name: string;
  lat: number;
  lng: number;
  /** Where they are heading, drawn as a line from the dot. */
  toLat: number | null;
  toLng: number | null;
}

export interface StopPin {
  index: number;
  customerName: string;
  lat: number;
  lng: number;
}

/**
 * The trucks and the houses, on one map.
 *
 * Green pins for today's stops, numbered in order; a blue dot per person
 * where their phone last reported, with a line to the house they are
 * heading to. Rebuilt on every refresh: a minute-old map redrawn whole is
 * simpler than one kept in sync by hand, and nobody is watching it move.
 */
export function CrewMap({ crews, stops }: { crews: CrewDot[]; stops: StopPin[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !publicEnv.mapboxToken) return;
    const points: [number, number][] = [
      ...stops.map((s) => [s.lng, s.lat] as [number, number]),
      ...crews.map((c) => [c.lng, c.lat] as [number, number]),
    ];
    if (points.length === 0) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: points[0],
      zoom: 11,
      attributionControl: false,
    });

    map.on("load", () => {
      const lines = crews
        .filter((c) => c.toLat != null && c.toLng != null)
        .map((c) => ({
          type: "Feature" as const,
          properties: {},
          geometry: { type: "LineString" as const, coordinates: [[c.lng, c.lat], [c.toLng as number, c.toLat as number]] },
        }));
      if (lines.length > 0) {
        map.addSource("heading", { type: "geojson", data: { type: "FeatureCollection", features: lines } });
        map.addLayer({
          id: "heading",
          type: "line",
          source: "heading",
          paint: { "line-color": "#1d4ed8", "line-width": 2, "line-dasharray": [2, 2] },
        });
      }

      for (const s of stops) {
        const el = document.createElement("div");
        el.className =
          "flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-emerald-700 text-[11px] font-bold text-white shadow";
        el.textContent = String(s.index);
        el.title = s.customerName;
        new mapboxgl.Marker({ element: el }).setLngLat([s.lng, s.lat]).addTo(map);
      }
      for (const c of crews) {
        const el = document.createElement("div");
        el.className =
          "flex items-center gap-1 rounded-full border-2 border-white bg-blue-700 px-2 py-0.5 text-[11px] font-semibold text-white shadow";
        el.textContent = c.name.split(" ")[0];
        new mapboxgl.Marker({ element: el }).setLngLat([c.lng, c.lat]).addTo(map);
      }

      if (points.length === 1) {
        map.setCenter(points[0]);
        map.setZoom(13);
      } else {
        const bounds = points.reduce((b, p) => b.extend(p), new mapboxgl.LngLatBounds(points[0], points[0]));
        map.fitBounds(bounds, { padding: 40, duration: 0, maxZoom: 14 });
      }
    });

    return () => map.remove();
  }, [crews, stops]);

  if (!publicEnv.mapboxToken) return null;
  return <div ref={containerRef} className="h-56 w-full overflow-hidden rounded-lg border border-border" />;
}
