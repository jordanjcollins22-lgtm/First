"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { Loader2 } from "lucide-react";

import { env } from "@/lib/env";
import { orderAlongLine, type Point } from "@/lib/route-order";
import type { ZoneHouse } from "@/app/api/marketing/[playId]/zone-houses/route";

/**
 * What a tap on the map does.
 *
 * "pick" is what it always did — on the round or off it. The other two are the
 * two ways of saying what order the round is walked in, which are the same
 * answer arrived at differently: tap the doors in order, or draw the line the
 * walk should follow and let the doors fall along it.
 */
export type PickerMode = "pick" | "order" | "line";

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
  mode = "pick",
  order = [],
  onOrder,
  line = [],
  onLine,
}: {
  houses: ZoneHouse[];
  /** The ids currently on the round, after the edits made so far. */
  on: Set<string>;
  onToggle: (houseId: string) => void;
  mode?: PickerMode;
  /** House ids in the order they will be walked, so far. */
  order?: string[];
  onOrder?: (order: string[]) => void;
  /** The line drawn to describe the walk. */
  line?: Point[];
  onLine?: (line: Point[]) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [ready, setReady] = useState(false);

  // The callback and the selection are read from refs inside the map's own
  // event handler, which is registered once. Without this the handler closes
  // over the first render's props and every tap after the first is ignored.
  const onRef = useRef(on);
  const toggleRef = useRef(onToggle);
  const modeRef = useRef(mode);
  const orderRef = useRef(order);
  const orderCbRef = useRef(onOrder);
  const lineRef = useRef(line);
  const lineCbRef = useRef(onLine);
  const housesRef = useRef(houses);
  onRef.current = on;
  toggleRef.current = onToggle;
  modeRef.current = mode;
  orderRef.current = order;
  orderCbRef.current = onOrder;
  lineRef.current = line;
  lineCbRef.current = onLine;
  housesRef.current = houses;

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
      // The drawn line sits under the houses, so a door is never hidden by it.
      map.addSource("drawn", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "drawn",
        type: "line",
        source: "drawn",
        paint: { "line-color": "#c2410c", "line-width": 3, "line-dasharray": [2, 1] },
      });

      map.addLayer({
        id: "houses",
        type: "circle",
        source: "houses",
        paint: {
          "circle-radius": ["case", ["has", "seq"], 9, ["get", "on"], 6, 4],
          "circle-color": ["case", ["has", "seq"], "#c2410c", ["get", "on"], "#2f6d3c", "#ffffff"],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": ["case", ["has", "seq"], "#7c2d12", ["get", "on"], "#1c4526", "#94a3b8"],
        },
      });

      // The walking position, drawn on the door itself. Nothing else on the
      // map says which is first, and "first" is the whole point of the mode.
      map.addLayer({
        id: "house-seq",
        type: "symbol",
        source: "houses",
        filter: ["has", "seq"],
        layout: {
          "text-field": ["to-string", ["get", "seq"]],
          "text-size": 10,
          "text-font": ["DIN Offc Pro Bold", "Arial Unicode MS Bold"],
          "text-allow-overlap": true,
        },
        paint: { "text-color": "#ffffff" },
      });

      map.on("click", "houses", (event) => {
        const id = event.features?.[0]?.properties?.id;
        if (typeof id !== "string") return;

        if (modeRef.current === "order") {
          // Tapping a door adds it to the walk; tapping it again takes it back
          // out, so a mis-tap costs one tap rather than starting again.
          const current = orderRef.current;
          const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
          orderCbRef.current?.(next);
          return;
        }
        if (modeRef.current === "line") return;
        toggleRef.current(id);
      });

      // Drawing the line: each click drops a point, and the doors are ordered
      // along it as it goes, so the numbers appear while it is being drawn
      // rather than after it is finished.
      map.on("click", (event) => {
        if (modeRef.current !== "line") return;
        const hit = map.queryRenderedFeatures(event.point, { layers: ["houses"] });
        if (hit.length > 0) return;
        const next = [...lineRef.current, { lat: event.lngLat.lat, lng: event.lngLat.lng }];
        lineCbRef.current?.(next);
        if (next.length >= 2) {
          const eligible = housesRef.current.filter((h) => onRef.current.has(h.id));
          orderCbRef.current?.(orderAlongLine(eligible, next).ordered);
        }
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
    const position = new Map(order.map((id, i) => [id, i + 1]));
    source?.setData({
      type: "FeatureCollection",
      features: houses.map((house) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [house.lng, house.lat] },
        properties: {
          id: house.id,
          address: house.address,
          on: on.has(house.id),
          // Absent rather than zero: the layers filter on whether it is there.
          ...(position.has(house.id) ? { seq: position.get(house.id) } : {}),
        },
      })),
    });

    const drawn = map.getSource("drawn") as mapboxgl.GeoJSONSource | undefined;
    drawn?.setData({
      type: "FeatureCollection",
      features:
        line.length > 1
          ? [
              {
                type: "Feature",
                properties: {},
                geometry: { type: "LineString", coordinates: line.map((p) => [p.lng, p.lat]) },
              },
            ]
          : [],
    });
  }, [houses, on, order, line, ready]);

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
        {mode === "pick" && "Tap a house to put it on the round or take it off. Filled means it's on."}
        {mode === "order" && "Tap the doors in the order you want them walked. Tap one again to take it back out."}
        {mode === "line" &&
          "Click along the way you want the round walked. The doors are numbered as they fall along the line."}
      </p>
    </div>
  );
}
