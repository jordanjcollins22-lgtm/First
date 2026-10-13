"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import "mapbox-gl/dist/mapbox-gl.css";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";

import { publicEnv } from "@/lib/public-env";
import type { LatLng } from "@/lib/sales/territories";

if (publicEnv.mapboxToken) mapboxgl.accessToken = publicEnv.mapboxToken;

/**
 * One evaluator's territory, drawn on the map: as many areas as they cover,
 * with the last 90 days' evaluations as dots so the lines can be drawn
 * around where the work actually is. Other evaluators' areas show faintly
 * behind, so two territories are not drawn on top of each other by
 * accident (they may overlap on purpose: then either can take it).
 */
export function TerritoryMap({
  areas,
  others,
  pins,
  onChange,
}: {
  areas: LatLng[][];
  others: LatLng[][];
  pins: { lat: number; lng: number; mine: boolean }[];
  onChange: (areas: LatLng[][]) => void;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Built once per evaluator (the parent keys it): what was drawn goes in,
  // every change comes out.
  useEffect(() => {
    if (!box.current || !publicEnv.mapboxToken) return;
    const map = new mapboxgl.Map({
      container: box.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [-76.35, 39.52],
      zoom: 10,
      attributionControl: false,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    const draw = new MapboxDraw({ displayControlsDefault: false, controls: { polygon: true, trash: true } });
    map.addControl(draw, "top-left");

    const ring = (r: LatLng[]) => [...r, r[0]].map((p) => [p.lng, p.lat]);
    map.on("load", () => {
      map.addSource("others", {
        type: "geojson",
        data: { type: "FeatureCollection", features: others.map((r) => ({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring(r)] } })) },
      });
      map.addLayer({ id: "others-fill", type: "fill", source: "others", paint: { "fill-color": "#64748b", "fill-opacity": 0.12 } });
      map.addSource("pins", {
        type: "geojson",
        data: { type: "FeatureCollection", features: pins.map((p) => ({ type: "Feature", properties: { mine: p.mine }, geometry: { type: "Point", coordinates: [p.lng, p.lat] } })) },
      });
      map.addLayer({
        id: "pins",
        type: "circle",
        source: "pins",
        paint: { "circle-radius": 4, "circle-color": ["case", ["get", "mine"], "#16a34a", "#94a3b8"], "circle-stroke-width": 1, "circle-stroke-color": "#fff" },
      });
      for (const r of areas) draw.add({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring(r)] } });
      const all = [...areas, ...(areas.length ? [] : pins.filter((p) => p.mine).map((p) => [p]))].flat();
      if (all.length > 0) {
        const bounds = new mapboxgl.LngLatBounds();
        for (const p of all) bounds.extend([p.lng, p.lat]);
        map.fitBounds(bounds, { padding: 40, maxZoom: 13, duration: 0 });
      }
    });

    const publish = () => {
      const out: LatLng[][] = [];
      for (const f of draw.getAll().features) {
        if (f.geometry.type !== "Polygon") continue;
        const r = f.geometry.coordinates[0] ?? [];
        const points = r.slice(0, Math.max(0, r.length - 1)).map(([lng, lat]) => ({ lat, lng }));
        if (points.length >= 3) out.push(points);
      }
      onChangeRef.current(out);
    };
    map.on("draw.create", publish);
    map.on("draw.update", publish);
    map.on("draw.delete", publish);
    return () => map.remove();
    // Drawn once; the parent remounts it for another evaluator.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!publicEnv.mapboxToken) {
    return <p className="rounded-xl border bg-card p-3 text-sm text-muted-foreground">The map needs Mapbox: not connected. Add it in Settings › Integrations. Zip codes still work.</p>;
  }
  return <div ref={box} className="h-80 w-full overflow-hidden rounded-xl border sm:h-96" />;
}
