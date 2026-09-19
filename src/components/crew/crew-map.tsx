"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

import { publicEnv } from "@/lib/public-env";
import { createClient } from "@/lib/supabase/client";

if (publicEnv.mapboxToken) {
  mapboxgl.accessToken = publicEnv.mapboxToken;
}

export interface CrewDot {
  profileId: string;
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

/** How often to ask the server outright, in case the live feed drops. */
const POLL_MS = 15_000;

/**
 * The trucks and the houses, on one map, live.
 *
 * Green pins for today's stops, numbered in order; a blue dot per person
 * where their phone last reported, with a line to the house they are
 * heading to. The dots move: the map listens for each phone's report as it
 * lands and slides the dot along the road, and asks the server outright
 * every so often in case the live feed dropped. The page underneath is not
 * reloaded for any of it, so somebody watching a truck keeps watching it.
 */
export function CrewMap({ crews, stops }: { crews: CrewDot[]; stops: StopPin[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const crewsRef = useRef<CrewDot[]>(crews);

  // Build the map once; stops and dots are redrawn on it, not with it.
  useEffect(() => {
    if (!containerRef.current || !publicEnv.mapboxToken || mapRef.current) return;
    const markers = markersRef.current;
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
    mapRef.current = map;

    map.on("load", () => {
      map.addSource("heading", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "heading",
        type: "line",
        source: "heading",
        paint: { "line-color": "#1d4ed8", "line-width": 2, "line-dasharray": [2, 2] },
      });
      for (const s of stops) {
        const el = document.createElement("div");
        el.className =
          "flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-emerald-700 text-[11px] font-bold text-white shadow";
        el.textContent = String(s.index);
        el.title = s.customerName;
        new mapboxgl.Marker({ element: el }).setLngLat([s.lng, s.lat]).addTo(map);
      }
      drawCrews(map, markersRef.current, crewsRef.current);

      if (points.length === 1) {
        map.setCenter(points[0]);
        map.setZoom(13);
      } else {
        const bounds = points.reduce((b, p) => b.extend(p), new mapboxgl.LngLatBounds(points[0], points[0]));
        map.fitBounds(bounds, { padding: 40, duration: 0, maxZoom: 14 });
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
      markers.clear();
    };
    // Built once. Later positions arrive through the live feed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A fresh page render (the panel refreshes its text every minute) brings
  // fresh dots; move the markers rather than rebuilding the map.
  useEffect(() => {
    crewsRef.current = crews;
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    drawCrews(map, markersRef.current, crews);
  }, [crews]);

  // The live feed: every report a phone makes lands here within a second.
  useEffect(() => {
    if (!publicEnv.mapboxToken) return;
    const supabase = createClient();
    const move = (row: { profile_id: string; lat: number; lng: number }) => {
      const map = mapRef.current;
      if (!map) return;
      const current = crewsRef.current.map((c) => (c.profileId === row.profile_id ? { ...c, lat: row.lat, lng: row.lng } : c));
      crewsRef.current = current;
      if (map.isStyleLoaded()) drawCrews(map, markersRef.current, current);
    };
    const channel = supabase
      .channel("crew_positions_live")
      .on("postgres_changes", { event: "*", schema: "public", table: "crew_positions" }, (payload) => {
        const row = payload.new as { profile_id?: string; lat?: number; lng?: number } | null;
        if (row?.profile_id && typeof row.lat === "number" && typeof row.lng === "number") {
          move({ profile_id: row.profile_id, lat: row.lat, lng: row.lng });
        }
      })
      .subscribe();

    // Belt and braces: ask outright every so often, so a dropped socket is
    // at worst a few seconds behind rather than frozen.
    const poll = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      const ids = crewsRef.current.map((c) => c.profileId);
      if (ids.length === 0) return;
      const { data } = await supabase.from("crew_positions").select("profile_id, lat, lng").in("profile_id", ids);
      for (const row of data ?? []) move(row);
    }, POLL_MS);

    return () => {
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, []);

  if (!publicEnv.mapboxToken) return null;
  return <div ref={containerRef} className="h-56 w-full overflow-hidden rounded-lg border border-border" />;
}

/** Put every dot where its person is now, and the line to where they are going. */
function drawCrews(map: mapboxgl.Map, markers: Map<string, mapboxgl.Marker>, crews: CrewDot[]) {
  const seen = new Set<string>();
  for (const c of crews) {
    seen.add(c.profileId);
    const existing = markers.get(c.profileId);
    if (existing) {
      existing.setLngLat([c.lng, c.lat]);
      continue;
    }
    const el = document.createElement("div");
    el.className =
      "flex items-center gap-1 rounded-full border-2 border-white bg-blue-700 px-2 py-0.5 text-[11px] font-semibold text-white shadow transition-transform";
    el.textContent = c.name.split(" ")[0];
    markers.set(c.profileId, new mapboxgl.Marker({ element: el }).setLngLat([c.lng, c.lat]).addTo(map));
  }
  for (const [id, marker] of markers) {
    if (!seen.has(id)) {
      marker.remove();
      markers.delete(id);
    }
  }
  const source = map.getSource("heading") as mapboxgl.GeoJSONSource | undefined;
  source?.setData({
    type: "FeatureCollection",
    features: crews
      .filter((c) => c.toLat != null && c.toLng != null)
      .map((c) => ({
        type: "Feature" as const,
        properties: {},
        geometry: { type: "LineString" as const, coordinates: [[c.lng, c.lat], [c.toLng as number, c.toLat as number]] },
      })),
  });
}
