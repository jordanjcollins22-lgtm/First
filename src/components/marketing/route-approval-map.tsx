"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import "mapbox-gl/dist/mapbox-gl.css";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";

import { publicEnv } from "@/lib/public-env";
import type { LngLatPair } from "@/lib/eddm";
import type { RouteHouse, WalkShape } from "@/lib/route-approval";
import type { Point } from "@/lib/route-order";

/** Which thing the next taps on the map put down. */
export type DrawTool = "area" | "line" | "park" | "start" | "end" | null;

const ROLE_LABEL: Record<"park" | "start" | "end", string> = { park: "P", start: "Start", end: "End" };

if (publicEnv.mapboxToken) mapboxgl.accessToken = publicEnv.mapboxToken;

/**
 * One USPS route, big, with the houses on it.
 *
 * The outline and the carrier's streets are what USPS sells; the dots are
 * every door on it; the rings are the paid jobs we did. While drawing, the
 * person puts down an area, parking spots, a start, an end and the walking
 * line, one tool at a time, and the doors inside the area light up as the
 * shape takes form.
 */
export function RouteApprovalMap({
  rings,
  paths,
  houses,
  anchorIds,
  onRound,
  drawing,
  focus = "route",
  tool,
  shape,
  onShape,
  resetKey = 0,
}: {
  rings: LngLatPair[][];
  paths: LngLatPair[][];
  houses: RouteHouse[];
  /** The houses of the paid, finished jobs the route was picked for. */
  anchorIds: string[];
  /** The doors the drawn lines reach, in order. Only while drawing. */
  onRound: Set<string>;
  drawing: boolean;
  /**
   * What the map is for right now. "route": the whole carrier route and
   * every door on it, for approving the mailing and drawing the walk.
   * "round": only the doors on the drawn walk, with the line over them,
   * and the map fitted to it, for confirming what gets hung.
   */
  focus?: "route" | "round";
  /** What the next taps put down, while drawing. */
  tool?: DrawTool;
  /** The walk as it stands: drawn so far, or saved. */
  shape: WalkShape;
  onShape: (shape: WalkShape) => void;
  /** Bump it to wipe everything drawn. */
  resetKey?: number;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  // What the dots last showed, so a render that changes nothing on the map
  // does not push six hundred features through it again.
  const dotsKeyRef = useRef<string>("");
  // The latest handler and tool, so the draw control is not rebuilt on every render.
  const onShapeRef = useRef(onShape);
  const toolRef = useRef<DrawTool>(tool ?? null);
  useEffect(() => {
    onShapeRef.current = onShape;
  }, [onShape]);

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
      map.addSource("area", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "area-fill", type: "fill", source: "area", paint: { "fill-color": "#f59e0b", "fill-opacity": 0.15 } });
      map.addLayer({ id: "area-line", type: "line", source: "area", paint: { "line-color": "#f59e0b", "line-width": 2, "line-dasharray": [3, 2] } });
      map.addSource("houses", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "houses-dots",
        type: "circle",
        source: "houses",
        paint: {
          "circle-radius": ["case", ["==", ["get", "state"], "anchor"], 8, ["==", ["get", "state"], "on"], 6, 3],
          "circle-color": ["match", ["get", "state"], "anchor", "#dc2626", "on", "#f59e0b", "#ffffff"],
          "circle-stroke-color": ["match", ["get", "state"], "on", "#7c2d12", "#111827"],
          "circle-stroke-width": ["case", ["==", ["get", "state"], "on"], 1.5, 0.5],
          // The doors not on the walk are there to draw along, not to look at.
          "circle-opacity": ["case", ["==", ["get", "state"], "off"], 0.55, 1],
        },
      });
      // The line goes on top of the doors it threads, or it vanishes under them.
      map.addSource("saved", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "saved-line", type: "line", source: "saved", paint: { "line-color": "#f59e0b", "line-width": 4, "line-opacity": 0.9 } });
      // Parking, start and end: a pin with a word on it.
      map.addSource("marks", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "marks-dot",
        type: "circle",
        source: "marks",
        paint: {
          "circle-radius": 11,
          "circle-color": ["match", ["get", "role"], "park", "#1d4ed8", "start", "#15803d", "end", "#b91c1c", "#111827"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({
        id: "marks-text",
        type: "symbol",
        source: "marks",
        layout: { "text-field": ["get", "label"], "text-size": 11, "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"], "text-allow-overlap": true },
        paint: { "text-color": "#ffffff" },
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
      if (focus === "round" && ((shape.area && shape.area.length >= 3) || (shape.line && shape.line.length > 1))) return;
      const bounds = new mapboxgl.LngLatBounds();
      for (const ring of rings) for (const [lng, lat] of ring) bounds.extend([lng, lat]);
      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 30, duration: 0 });
    };
    if (map.isStyleLoaded() && map.getSource("route")) apply();
    else map.once("ready", apply);
    // The fit is to the route; the walk's own fit lives with the saved line.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rings, paths]);

  // The dots, coloured by what they are right now. Repainted only when a
  // dot's colour has changed: the wizard re-renders for a typed date or a
  // note, and the map has nothing to do with either.
  const anchorKey = anchorIds.join("|");
  const onKey = [...onRound].join("|");
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const key = `${focus}:${houses.length}:${anchorKey}:${onKey}`;
    if (key === dotsKeyRef.current) return;
    const anchors = new Set(anchorKey ? anchorKey.split("|") : []);
    const apply = () => {
      const source = map.getSource("houses") as mapboxgl.GeoJSONSource | undefined;
      if (!source) return;
      dotsKeyRef.current = key;
      const shown = focus === "round" ? houses.filter((h) => anchors.has(h.id) || onRound.has(h.id)) : houses;
      source.setData({
        type: "FeatureCollection",
        features: shown.map((h) => ({
          type: "Feature",
          properties: { state: anchors.has(h.id) ? "anchor" : onRound.has(h.id) ? "on" : "off", address: h.address },
          geometry: { type: "Point", coordinates: [h.lng, h.lat] },
        })),
      });
    };
    if (map.isStyleLoaded() && map.getSource("houses")) apply();
    else map.once("ready", apply);
  }, [houses, anchorKey, onKey, onRound, focus]);

  // The finished walk, once drawing is over: the area, the line, and always
  // the pins. While drawing, the draw control shows the area and the line
  // itself; only the pins' words are ours.
  const shapeKey = JSON.stringify(shape);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const saved = map.getSource("saved") as mapboxgl.GeoJSONSource | undefined;
      const area = map.getSource("area") as mapboxgl.GeoJSONSource | undefined;
      const marks = map.getSource("marks") as mapboxgl.GeoJSONSource | undefined;
      if (!saved || !area || !marks) return;
      const line = !drawing && shape.line && shape.line.length > 1 ? shape.line : null;
      saved.setData({
        type: "FeatureCollection",
        features: line ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: line.map((p) => [p.lng, p.lat]) } }] : [],
      });
      const ring = !drawing && shape.area && shape.area.length >= 3 ? [...shape.area, shape.area[0]] : null;
      area.setData({
        type: "FeatureCollection",
        features: ring ? [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring.map((p) => [p.lng, p.lat])] } }] : [],
      });
      const pins: { role: "park" | "start" | "end"; at: Point }[] = [
        ...shape.parks.map((at) => ({ role: "park" as const, at })),
        ...(shape.start ? [{ role: "start" as const, at: shape.start }] : []),
        ...(shape.end ? [{ role: "end" as const, at: shape.end }] : []),
      ];
      marks.setData({
        type: "FeatureCollection",
        features: pins.map((pin) => ({
          type: "Feature",
          properties: { role: pin.role, label: ROLE_LABEL[pin.role] },
          geometry: { type: "Point", coordinates: [pin.at.lng, pin.at.lat] },
        })),
      });
      // Looking at the walk, not the whole route: close in on it.
      if (!drawing && focus === "round" && (ring || line)) {
        const bounds = new mapboxgl.LngLatBounds();
        for (const p of ring ?? line ?? []) bounds.extend([p.lng, p.lat]);
        for (const pin of pins) bounds.extend([pin.at.lng, pin.at.lat]);
        if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 48, duration: 0, maxZoom: 17 });
      }
    };
    if (map.isStyleLoaded() && map.getSource("saved")) apply();
    else map.once("ready", apply);
    // shapeKey stands in for shape.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawing, shapeKey, focus]);

  // Drawing: the control comes and goes with the step. What is already
  // drawn is put back on it, so a phone put down half way picks up.
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
    const draw = new MapboxDraw({ displayControlsDefault: false, controls: { trash: true } });
    drawRef.current = draw;
    map.addControl(draw, "top-left");
    const starting = shape;
    if (starting.area && starting.area.length >= 3) {
      const ring = [...starting.area, starting.area[0]].map((p) => [p.lng, p.lat]);
      draw.add({ type: "Feature", properties: { role: "area" }, geometry: { type: "Polygon", coordinates: [ring] } });
    }
    if (starting.line && starting.line.length > 1) {
      draw.add({ type: "Feature", properties: { role: "line" }, geometry: { type: "LineString", coordinates: starting.line.map((p) => [p.lng, p.lat]) } });
    }
    for (const at of starting.parks) draw.add({ type: "Feature", properties: { role: "park" }, geometry: { type: "Point", coordinates: [at.lng, at.lat] } });
    if (starting.start) draw.add({ type: "Feature", properties: { role: "start" }, geometry: { type: "Point", coordinates: [starting.start.lng, starting.start.lat] } });
    if (starting.end) draw.add({ type: "Feature", properties: { role: "end" }, geometry: { type: "Point", coordinates: [starting.end.lng, starting.end.lat] } });

    // Dragging a point fires an update on every pixel. One publish per
    // frame is all the eye can use, and all the doors need recounting for.
    let frame: number | null = null;
    const read = (): WalkShape => {
      const out: WalkShape = { area: null, line: null, parks: [], start: null, end: null };
      for (const f of draw.getAll().features) {
        const role = (f.properties?.role as string | undefined) ?? null;
        if (f.geometry.type === "Polygon" && !out.area) {
          const ring = f.geometry.coordinates[0] ?? [];
          out.area = ring.slice(0, Math.max(0, ring.length - 1)).map(([lng, lat]) => ({ lat, lng }));
        } else if (f.geometry.type === "LineString" && !out.line) {
          out.line = f.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
        } else if (f.geometry.type === "Point") {
          const [lng, lat] = f.geometry.coordinates;
          if (role === "start") out.start = { lat, lng };
          else if (role === "end") out.end = { lat, lng };
          else out.parks.push({ lat, lng });
        }
      }
      return out;
    };
    const publish = () => {
      if (frame != null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        onShapeRef.current(read());
      });
    };
    // A new feature takes the role of the tool that made it. One start,
    // one end: putting down another moves it.
    const created = (e: { features: GeoJSON.Feature[] }) => {
      const role = toolRef.current;
      for (const f of e.features) {
        if (f.id == null) continue;
        const id = String(f.id);
        if (f.geometry.type === "Point" && (role === "park" || role === "start" || role === "end")) {
          draw.setFeatureProperty(id, "role", role);
          if (role !== "park") {
            for (const other of draw.getAll().features) {
              if (other.id != null && String(other.id) !== id && other.geometry.type === "Point" && other.properties?.role === role) draw.delete(String(other.id));
            }
          }
        } else if (f.geometry.type === "Polygon") {
          draw.setFeatureProperty(id, "role", "area");
          for (const other of draw.getAll().features) {
            if (other.id != null && String(other.id) !== id && other.geometry.type === "Polygon") draw.delete(String(other.id));
          }
        } else if (f.geometry.type === "LineString") {
          draw.setFeatureProperty(id, "role", "line");
          for (const other of draw.getAll().features) {
            if (other.id != null && String(other.id) !== id && other.geometry.type === "LineString") draw.delete(String(other.id));
          }
        }
      }
      publish();
      // Back to the same tool, so a second parking spot is one more tap.
      if (role === "park") draw.changeMode("draw_point");
    };
    map.on("draw.create", created);
    map.on("draw.update", publish);
    map.on("draw.delete", publish);
    return () => {
      if (frame != null) cancelAnimationFrame(frame);
      map.off("draw.create", created);
      map.off("draw.update", publish);
      map.off("draw.delete", publish);
      if (drawRef.current === draw) {
        map.removeControl(draw);
        drawRef.current = null;
      }
    };
    // The starting shape is read once, when drawing opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawing]);

  // Wiping the drawing, when asked.
  useEffect(() => {
    if (resetKey === 0) return;
    const draw = drawRef.current;
    if (!draw) return;
    draw.deleteAll();
    onShapeRef.current({ area: null, line: null, parks: [], start: null, end: null });
  }, [resetKey]);

  // The tool in hand decides what the next taps make.
  useEffect(() => {
    toolRef.current = tool ?? null;
    const draw = drawRef.current;
    if (!draw || !drawing) return;
    try {
      if (tool === "area") draw.changeMode("draw_polygon");
      else if (tool === "line") draw.changeMode("draw_line_string");
      else if (tool === "park" || tool === "start" || tool === "end") draw.changeMode("draw_point");
      else draw.changeMode("simple_select");
    } catch {
      // A mode change while the control is mid-teardown is nothing to act on.
    }
  }, [tool, drawing]);

  return <div ref={box} className="h-[420px] w-full rounded-xl border border-border bg-muted sm:h-[520px]" />;
}
