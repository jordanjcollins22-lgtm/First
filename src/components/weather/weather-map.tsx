"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { CloudRain, Pause, Play } from "lucide-react";

import { env } from "@/lib/env";
import { weatherEmoji } from "@/lib/weather";
import type { LocationForecast } from "@/lib/weather";

if (env.mapboxToken) {
  mapboxgl.accessToken = env.mapboxToken;
}

const RADAR_SOURCE = "rainviewer-radar";
const RADAR_LAYER = "rainviewer-radar-layer";

interface RadarFrame {
  time: number;
  path: string;
  /** Nowcast frames are the forecast half — what's about to arrive. */
  forecast: boolean;
}

interface RainViewerIndex {
  host: string;
  radar?: {
    past?: { time: number; path: string }[];
    nowcast?: { time: number; path: string }[];
  };
}

/**
 * The locations on a map, with an optional radar overlay that steps through
 * recent frames into the near-term forecast.
 *
 * Radar comes from RainViewer, which like Open-Meteo needs no key. Its tiles
 * are plain rasters, so this is one source and one layer swapped as the frame
 * changes rather than anything custom.
 */
export function WeatherMap({ locations }: { locations: LocationForecast[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [ready, setReady] = useState(false);

  const [showRadar, setShowRadar] = useState(false);
  const [frames, setFrames] = useState<RadarFrame[]>([]);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [radarError, setRadarError] = useState(false);

  // Map setup. Locations never change while this is mounted, so this runs once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current || !env.mapboxToken) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: [locations[0]?.lng ?? -76.19, locations[0]?.lat ?? 39.53],
      zoom: 9,
    });
    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    mapRef.current = map;

    map.on("load", () => {
      if (locations.length > 1) {
        const bounds = new mapboxgl.LngLatBounds();
        locations.forEach((l) => bounds.extend([l.lng, l.lat]));
        map.fitBounds(bounds, { padding: 80, maxZoom: 11 });
      }
      setReady(true);
    });

    for (const location of locations) {
      const el = document.createElement("div");
      el.className =
        "flex items-center gap-1 rounded-full border border-white/70 bg-card/90 px-2 py-1 text-xs font-semibold shadow-lg backdrop-blur";
      el.textContent = `${location.current ? weatherEmoji(location.current.code) : "📍"} ${
        location.current ? `${location.current.temp}°` : location.name
      }`;
      new mapboxgl.Marker({ element: el })
        .setLngLat([location.lng, location.lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 12 }).setText(
            location.current
              ? `${location.name} — ${location.current.temp}°, wind ${location.current.wind} mph`
              : location.name
          )
        )
        .addTo(map);
    }

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Radar frame index, fetched the first time the overlay is switched on.
  useEffect(() => {
    if (!showRadar || frames.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("https://api.rainviewer.com/public/weather-maps.json");
        if (!res.ok) throw new Error(String(res.status));
        const index = (await res.json()) as RainViewerIndex;
        if (cancelled) return;
        const past = (index.radar?.past ?? []).map((f) => ({ ...f, forecast: false }));
        const nowcast = (index.radar?.nowcast ?? []).map((f) => ({ ...f, forecast: true }));
        const all = [...past.slice(-6), ...nowcast].map((f) => ({
          ...f,
          path: `${index.host}${f.path}`,
        }));
        if (all.length === 0) throw new Error("no frames");
        setFrames(all);
        // Start at "now" — the last past frame — so the overlay opens on
        // what's actually overhead, and playing runs into the forecast.
        setFrameIndex(Math.max(0, past.slice(-6).length - 1));
      } catch {
        if (!cancelled) setRadarError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showRadar, frames.length]);

  // Paint the active frame.
  const paintFrame = useCallback(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    if (map.getLayer(RADAR_LAYER)) map.removeLayer(RADAR_LAYER);
    if (map.getSource(RADAR_SOURCE)) map.removeSource(RADAR_SOURCE);
    if (!showRadar) return;

    const frame = frames[frameIndex];
    if (!frame) return;

    map.addSource(RADAR_SOURCE, {
      type: "raster",
      tiles: [`${frame.path}/512/{z}/{x}/{y}/2/1_1.png`],
      tileSize: 512,
    });
    map.addLayer({
      id: RADAR_LAYER,
      type: "raster",
      source: RADAR_SOURCE,
      paint: { "raster-opacity": 0.65 },
    });
  }, [frames, frameIndex, showRadar]);

  useEffect(() => {
    if (!ready) return;
    paintFrame();
  }, [ready, paintFrame]);

  // Playback runs to the end of the forecast then stops, rather than looping
  // forever and burning battery on a phone in someone's pocket.
  useEffect(() => {
    if (!playing || frames.length === 0) return;
    const timer = setInterval(() => {
      setFrameIndex((i) => {
        if (i >= frames.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 600);
    return () => clearInterval(timer);
  }, [playing, frames.length]);

  if (!env.mapboxToken) {
    return (
      <div className="rounded-xl border border-white/60 bg-card/60 p-4 text-sm text-muted-foreground backdrop-blur-md">
        Add NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN to show the map.
      </div>
    );
  }

  const frame = frames[frameIndex];

  return (
    <div className="overflow-hidden rounded-xl border border-white/60 bg-card/60 backdrop-blur-md">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <button
          type="button"
          onClick={() => setShowRadar((v) => !v)}
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition ${
            showRadar ? "bg-primary text-primary-foreground" : "hover:bg-accent"
          }`}
        >
          <CloudRain className="h-4 w-4" />
          {showRadar ? "Weather overlay on" : "Show weather overlay"}
        </button>

        {showRadar && frames.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPlaying((v) => !v)}
              className="rounded-lg p-1.5 hover:bg-accent"
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
            <input
              type="range"
              min={0}
              max={frames.length - 1}
              value={frameIndex}
              onChange={(e) => {
                setPlaying(false);
                setFrameIndex(Number(e.target.value));
              }}
              className="w-32 sm:w-48"
              aria-label="Radar time"
            />
            <span className="w-28 text-xs tabular-nums text-muted-foreground">
              {frame
                ? `${new Date(frame.time * 1000).toLocaleTimeString(undefined, {
                    hour: "numeric",
                    minute: "2-digit",
                  })}${frame.forecast ? " (forecast)" : ""}`
                : ""}
            </span>
          </div>
        )}
      </div>

      {radarError && (
        <p className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
          Radar is unavailable right now. The map and forecasts still work.
        </p>
      )}

      <div ref={containerRef} className="h-[380px] w-full" />
    </div>
  );
}
