"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import "mapbox-gl/dist/mapbox-gl.css";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";

import { publicEnv } from "@/lib/public-env";
import type { LngLatPair } from "@/lib/eddm";
import type { RouteHouse } from "@/lib/route-approval";
import type { Point } from "@/lib/route-order";

if (publicEnv.mapboxToken) mapboxgl.accessToken = publicEnv.mapboxToken;

/**
 * One USPS route, big, with the houses on it.
 *
 * The outline and the carrier's streets are what USPS sells; the dots are
 * every door on it; the rings are the paid jobs we did. While drawing,
 * each tap along a street adds to the line and the doors within reach of
 * it light up, so the person sees the round take shape as they draw it.
 */
export function RouteApprovalMap({
  rings,
  paths,
  houses,
  anchorIds,
  onRound,
  drawing,
  initialLine,
  savedLine,
  onLines,
}: {
  rings: LngLatPair[][];
  paths: LngLatPair[][];
  houses: RouteHouse[];
  /** The houses of the paid, finished jobs the route was picked for. */
  anchorIds: string[];
  /** The doors the drawn lines reach, in order. Only while drawing. */
  onRound: Set<string>;
  drawing: boolean;
  /** A line already drawn on this round, to start from. */
  initialLine?: Point[] | null;
  /** The finished line, drawn plain once drawing is over. */
  savedLine?: Point[] | null;
  onLines: (lines: Point[][]) => void;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  // The latest handler, so the draw control is not rebuilt on every render.
  const onLinesRef = useRef(onLines);
  useEffect(() => {
    onLinesRef.current = onLines;
  }, [onLines]);

  // Built once. Everything below only feeds data into it.
  useEffect(() => {
    if (!box.current || !publicEnv.mapboxToken) return;
    const map = new mapboxgl.Map({
      container: box.current,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: [-76.35, 39.5],
      zoom: 13,
      attributionControl: false,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    map.on("load", () => {
      map.addSource("route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "route-fill", type: "fill", source: "route", paint: { "fill-color": "#2563eb", "fill-opacity": 0.12 } });
      map.addLayer({ id: "route-line", type: "line", source: "route", paint: { "line-color": "#2563eb", "line-width": 3 } });
      map.addSource("streets", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "streets-line", type: "line", source: "streets", paint: { "line-color": "#93c5fd", "line-width": 2, "line-dasharray": [2, 1] } });
      map.addSource("saved", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "saved-line", type: "line", source: "saved", paint: { "line-color": "#f59e0b", "line-width": 4 } });
      map.addSource("houses", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "houses-dots",
        type: "circle",
        source: "houses",
        paint: {
          "circle-radius": ["case", ["==", ["get", "state"], "anchor"], 8, ["==", ["get", "state"], "on"], 6, 4],
          "circle-color": ["match", ["get", "state"], "anchor", "#dc2626", "on", "#f59e0b", "#ffffff"],
          "circle-stroke-color": "#111827",
          "circle-stroke-width": 1,
          "circle-opacity": 0.95,
        },
      });
      map.fire("ready");
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Route outline and streets, and fit to them.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const route = map.getSource("route") as mapboxgl.GeoJSONSource | undefined;
      const streets = map.getSource("streets") as mapboxgl.GeoJSONSource | undefined;
      if (!route || !streets) return;
      route.setData({
        type: "FeatureCollection",
        features: rings.length > 0 ? [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: rings } }] : [],
      });
      streets.setData({
        type: "FeatureCollection",
        features: paths.length > 0 ? [{ type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: paths } }] : [],
      });
      const bounds = new mapboxgl.LngLatBounds();
      for (const ring of rings) for (const [lng, lat] of ring) bounds.extend([lng, lat]);
      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 30, duration: 0 });
    };
    if (map.isStyleLoaded() && map.getSource("route")) apply();
    else map.once("ready", apply);
  }, [rings, paths]);

  // The dots, coloured by what they are right now.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const anchors = new Set(anchorIds);
    const apply = () => {
      const source = map.getSource("houses") as mapboxgl.GeoJSONSource | undefined;
      if (!source) return;
      source.setData({
        type: "FeatureCollection",
        features: houses.map((h) => ({
          type: "Feature",
          properties: { state: anchors.has(h.id) ? "anchor" : onRound.has(h.id) ? "on" : "off", address: h.address },
          geometry: { type: "Point", coordinates: [h.lng, h.lat] },
        })),
      });
    };
    if (map.isStyleLoaded() && map.getSource("houses")) apply();
    else map.once("ready", apply);
  }, [houses, anchorIds, onRound]);

  // The finished line, once drawing is over.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const source = map.getSource("saved") as mapboxgl.GeoJSONSource | undefined;
      if (!source) return;
      const line = !drawing && savedLine && savedLine.length > 1 ? savedLine : null;
      source.setData({
        type: "FeatureCollection",
        features: line ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: line.map((p) => [p.lng, p.lat]) } }] : [],
      });
    };
    if (map.isStyleLoaded() && map.getSource("saved")) apply();
    else map.once("ready", apply);
  }, [drawing, savedLine]);

  // Drawing: the control comes and goes with the step.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!drawing) {
      if (drawRef.current) {
        map.removeControl(drawRef.current);
        drawRef.current = null;
      }
      return;
    }
    const draw = new MapboxDraw({ displayControlsDefault: false, controls: { line_string: true, trash: true } });
    drawRef.current = draw;
    map.addControl(draw, "top-left");
    if (initialLine && initialLine.length > 1) {
      draw.add({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: initialLine.map((p) => [p.lng, p.lat]) } });
    }
    draw.changeMode("draw_line_string");

    const publish = () => {
      const lines = draw
        .getAll()
        .features.filter((f) => f.geometry.type === "LineString")
        .map((f) => (f.geometry as GeoJSON.LineString).coordinates.map(([lng, lat]) => ({ lat, lng })));
      onLinesRef.current(lines);
    };
    map.on("draw.create", publish);
    map.on("draw.update", publish);
    map.on("draw.delete", publish);
    if (initialLine && initialLine.length > 1) publish();
    return () => {
      map.off("draw.create", publish);
      map.off("draw.update", publish);
      map.off("draw.delete", publish);
      if (drawRef.current === draw) {
        map.removeControl(draw);
        drawRef.current = null;
      }
    };
    // The starting line is read once, when drawing opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawing]);

  return <div ref={box} className="h-[420px] w-full rounded-xl border border-border bg-muted sm:h-[520px]" />;
}
