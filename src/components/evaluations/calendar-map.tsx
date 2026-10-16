"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

import { publicEnv } from "@/lib/public-env";
import { LAYER_COLORS } from "@/lib/calendar-events";
import type { CalendarEvent } from "@/lib/calendar-events";

if (publicEnv.mapboxToken) {
  mapboxgl.accessToken = publicEnv.mapboxToken;
}

/**
 * Where the day's work actually is. Markers are coloured by layer, so turning
 * a layer off in the calendar takes it off the map too — the checkboxes drive
 * both, which is the point of merging the two calendars.
 *
 * Markers are rebuilt whenever the events change rather than diffed: a day
 * holds a handful of stops, and rebuilding is simpler than reconciling.
 */
export function CalendarMap({
  events,
  dayLabel,
  focusId = null,
}: {
  events: CalendarEvent[];
  dayLabel: string;
  /** The appointment tapped in the day's list: the map zooms in on it and opens its label. */
  focusId?: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const markerById = useRef(new Map<string, mapboxgl.Marker>());

  useEffect(() => {
    if (!containerRef.current || mapRef.current || !publicEnv.mapboxToken) return;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [-76.19, 39.53],
      zoom: 9,
    });
    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const marker of markersRef.current) marker.remove();
    markersRef.current = [];
    markerById.current.clear();

    if (events.length === 0) return;

    const bounds = new mapboxgl.LngLatBounds();
    for (const event of events) {
      const el = document.createElement("div");
      el.style.width = "16px";
      el.style.height = "16px";
      el.style.borderRadius = "9999px";
      el.style.border = "2px solid white";
      el.style.boxShadow = "0 1px 4px rgba(0,0,0,0.4)";
      el.style.background = LAYER_COLORS[event.layer];

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([event.lng, event.lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 14 }).setText(
            `${event.customerName}, ${event.address} (${event.detail})`
          )
        )
        .addTo(map);
      markersRef.current.push(marker);
      markerById.current.set(event.id, marker);
      bounds.extend([event.lng, event.lat]);
    }

    if (events.length === 1) {
      map.easeTo({ center: [events[0].lng, events[0].lat], zoom: 13 });
    } else {
      map.fitBounds(bounds, { padding: 60, maxZoom: 13 });
    }
  }, [events]);

  // Tapping an appointment zooms in on it; tapping it again shows the whole day.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const marker of markersRef.current) if (marker.getPopup()?.isOpen()) marker.togglePopup();
    const event = focusId ? events.find((e) => e.id === focusId) : undefined;
    if (event) {
      map.flyTo({ center: [event.lng, event.lat], zoom: 16 });
      markerById.current.get(event.id)?.togglePopup();
    } else if (events.length > 1) {
      const bounds = new mapboxgl.LngLatBounds();
      for (const e of events) bounds.extend([e.lng, e.lat]);
      map.fitBounds(bounds, { padding: 60, maxZoom: 13 });
    }
  }, [focusId, events]);

  if (!publicEnv.mapboxToken) return null;

  return (
    <div className="overflow-hidden rounded-2xl border border-white/60 bg-card/70 shadow-lg shadow-black/5 backdrop-blur-xl">
      <p className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
        {events.length === 0 ? `Nothing scheduled ${dayLabel}` : `${events.length} stop${events.length === 1 ? "" : "s"} ${dayLabel}`}
      </p>
      <div ref={containerRef} className="h-64 w-full" />
    </div>
  );
}
