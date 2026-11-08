"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

import { publicEnv } from "@/lib/public-env";
import { areaLayers, plantLayers, stepPath, stepPins, PLANT_COLOR, type LngLat, type ModelArea, type ModelPlant, type ModelStep } from "@/lib/job-model";
import { ModelPlan } from "./model-plan";

if (publicEnv.mapboxToken) {
  mapboxgl.accessToken = publicEnv.mapboxToken;
}

export interface Camera {
  center: LngLat;
  zoom: number;
  pitch: number;
  bearing: number;
}

export interface JobModelMapProps {
  areas: ModelArea[];
  plants: ModelPlant[];
  steps: ModelStep[];
  truck: LngLat | null;
  house: LngLat[] | null;
  center: LngLat;
  bounds: [LngLat, LngLat] | null;
  selectedPlantId: string | null;
  activeStep: number | null;
  editing: boolean;
  /** A tap on the map places a plant. */
  placing: boolean;
  /** Where to fly, with a key so the same spot can be flown to twice. */
  flyTo: (Camera & { key: number; duration?: number }) | null;
  onMapClick: (at: LngLat) => void;
  onPlantMove: (id: string, at: LngLat) => void;
  onTruckMove: (at: LngLat) => void;
  onSelectPlant: (id: string | null) => void;
  onSelectStep: (index: number) => void;
}

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

const TRUCK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>';

/**
 * The satellite map, tilted, with the ground's real shape and the houses in
 * 3D, and the job on it: beds, plants at their real size, and the numbered
 * steps from the truck. With no map key (or no signal for the map), the same
 * job is drawn as a flat plan so the page still works.
 */
export function JobModelMap(props: JobModelMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const handlesRef = useRef<mapboxgl.Marker[]>([]);
  const truckRef = useRef<mapboxgl.Marker | null>(null);
  const propsRef = useRef(props);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(!publicEnv.mapboxToken);

  useEffect(() => {
    propsRef.current = props;
  });

  // The map, once.
  useEffect(() => {
    if (!publicEnv.mapboxToken || !containerRef.current) return;
    const p = propsRef.current;
    let map: mapboxgl.Map;
    try {
      map = new mapboxgl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/satellite-streets-v12",
        center: p.center,
        zoom: 19.2,
        pitch: 58,
        bearing: 0,
        maxPitch: 80,
        antialias: true,
        attributionControl: true,
      });
    } catch {
      // No WebGL on this device: the flat plan instead.
      const t = window.setTimeout(() => setFailed(true), 0);
      return () => window.clearTimeout(t);
    }
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "top-right");
    let loaded = false;
    const giveUp = window.setTimeout(() => {
      if (!loaded) setFailed(true);
    }, 15000);
    map.on("error", (e) => {
      const status = (e.error as { status?: number } | undefined)?.status;
      if (!loaded || status === 401 || status === 403) setFailed(true);
    });
    map.on("style.load", () => {
      loaded = true;
      window.clearTimeout(giveUp);
      map.addSource("mapbox-dem", { type: "raster-dem", url: "mapbox://mapbox.mapbox-terrain-dem-v1", tileSize: 512, maxzoom: 14 });
      map.setTerrain({ source: "mapbox-dem", exaggeration: 1 });
      map.setFog({});
      if (map.getSource("composite")) {
        map.addLayer({
          id: "jm-buildings",
          source: "composite",
          "source-layer": "building",
          filter: ["==", ["get", "extrude"], "true"],
          type: "fill-extrusion",
          minzoom: 15,
          paint: {
            "fill-extrusion-color": "#e7e5e4",
            "fill-extrusion-height": ["get", "height"],
            "fill-extrusion-base": ["get", "min_height"],
            "fill-extrusion-opacity": 0.55,
          },
        });
      }
      for (const id of ["jm-house", "jm-areas", "jm-route", "jm-plants", "jm-crosses", "jm-plant-labels", "jm-area-labels"]) map.addSource(id, { type: "geojson", data: EMPTY });
      map.addLayer({ id: "jm-house", type: "fill-extrusion", source: "jm-house", paint: { "fill-extrusion-color": "#f5f5f4", "fill-extrusion-height": 7, "fill-extrusion-opacity": 0.6 } });
      map.addLayer({ id: "jm-areas", type: "fill-extrusion", source: "jm-areas", paint: { "fill-extrusion-color": ["get", "color"], "fill-extrusion-height": 0.12, "fill-extrusion-opacity": 0.45 } });
      map.addLayer({ id: "jm-area-lines", type: "line", source: "jm-areas", paint: { "line-color": ["get", "color"], "line-width": 3 } });
      map.addLayer({ id: "jm-route", type: "line", source: "jm-route", layout: { "line-cap": "round" }, paint: { "line-color": "#ffffff", "line-width": 3, "line-dasharray": [1.5, 1.5], "line-opacity": 0.9 } });
      map.addLayer({ id: "jm-crosses", type: "line", source: "jm-crosses", layout: { "line-cap": "round" }, paint: { "line-color": PLANT_COLOR.remove, "line-width": 4 } });
      for (const status of ["keep", "new", "remove"] as const) {
        map.addLayer({
          id: `jm-plants-${status}`,
          type: "fill-extrusion",
          source: "jm-plants",
          filter: ["==", ["get", "status"], status],
          paint: {
            "fill-extrusion-color": ["get", "color"],
            "fill-extrusion-base": ["get", "base"],
            "fill-extrusion-height": ["get", "height"],
            "fill-extrusion-opacity": status === "remove" ? 0.7 : 0.95,
          },
        });
      }
      map.addLayer({ id: "jm-plant-selected", type: "line", source: "jm-plants", filter: ["==", ["get", "id"], ""], paint: { "line-color": "#facc15", "line-width": 3 } });
      map.addLayer({
        id: "jm-area-labels",
        type: "symbol",
        source: "jm-area-labels",
        layout: { "text-field": ["get", "label"], "text-size": 13, "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"], "text-allow-overlap": true },
        paint: { "text-color": "#ffffff", "text-halo-color": "rgba(0,0,0,0.75)", "text-halo-width": 1.6 },
      });
      map.addLayer({
        id: "jm-plant-labels",
        type: "symbol",
        source: "jm-plant-labels",
        minzoom: 20.3,
        layout: { "text-field": ["get", "name"], "text-size": 11, "text-offset": [0, 1.2], "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"] },
        paint: { "text-color": "#ffffff", "text-halo-color": "rgba(0,0,0,0.8)", "text-halo-width": 1.4 },
      });
      const b = propsRef.current.bounds;
      if (b) map.fitBounds(b, { padding: 60, pitch: 58, maxZoom: 20.2, duration: 0, bearing: map.getBearing() });
      setReady(true);
    });
    map.on("click", (e) => {
      const now = propsRef.current;
      if (now.placing) {
        now.onMapClick([e.lngLat.lng, e.lngLat.lat]);
        return;
      }
      const hit = map.queryRenderedFeatures(e.point, { layers: ["jm-plants-keep", "jm-plants-new", "jm-plants-remove"] })[0];
      now.onSelectPlant((hit?.properties?.id as string | undefined) ?? null);
    });
    return () => {
      window.clearTimeout(giveUp);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // The job's shapes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const set = (id: string, data: GeoJSON.FeatureCollection | GeoJSON.Feature) => (map.getSource(id) as mapboxgl.GeoJSONSource | undefined)?.setData(data);
    const areas = areaLayers(props.areas);
    const plants = plantLayers(props.plants);
    set("jm-areas", areas.fills);
    set("jm-area-labels", areas.labels);
    set("jm-plants", plants.shapes);
    set("jm-crosses", plants.crosses);
    set("jm-plant-labels", plants.labels);
    set("jm-route", stepPath(props.steps) ?? EMPTY);
    set("jm-house", props.house && props.house.length >= 3 ? { type: "Feature", geometry: { type: "Polygon", coordinates: [props.house] }, properties: {} } : EMPTY);
    map.setFilter("jm-plant-selected", ["all", ["==", ["get", "id"], props.selectedPlantId ?? ""], ["==", ["get", "tier"], 0]]);
    map.getCanvas().style.cursor = props.placing ? "crosshair" : "";
  }, [ready, props.areas, props.plants, props.steps, props.house, props.selectedPlantId, props.placing]);

  // Numbered step pins.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    for (const m of markersRef.current) m.remove();
    markersRef.current = stepPins(props.steps).map((pin) => {
      const el = document.createElement("button");
      el.type = "button";
      const active = props.activeStep != null && pin.numbers.includes(props.activeStep + 1);
      el.className = `rounded-full border-2 border-white px-2 py-0.5 text-xs font-bold shadow-lg ${active ? "bg-yellow-400 text-black" : "bg-slate-900/90 text-white"}`;
      el.textContent = pin.numbers.join("·");
      el.setAttribute("aria-label", `Step ${pin.numbers.join(" and ")}`);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        propsRef.current.onSelectStep(pin.numbers[0] - 1);
      });
      return new mapboxgl.Marker({ element: el, anchor: "bottom", offset: [0, -4] }).setLngLat(pin.at).addTo(map);
    });
  }, [ready, props.steps, props.activeStep]);

  // The truck, draggable while editing.
  useEffect(() => {
    const map = mapRef.current;
    truckRef.current?.remove();
    truckRef.current = null;
    if (!map || !ready || !props.truck) return;
    const el = document.createElement("div");
    el.className = "flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-orange-500 text-white shadow-lg";
    el.innerHTML = TRUCK_SVG;
    el.title = props.editing ? "Truck: drag to where it parks" : "Truck";
    const marker = new mapboxgl.Marker({ element: el, draggable: props.editing }).setLngLat(props.truck).addTo(map);
    marker.on("dragend", () => {
      const at = marker.getLngLat();
      propsRef.current.onTruckMove([at.lng, at.lat]);
    });
    truckRef.current = marker;
  }, [ready, props.truck, props.editing]);

  // Plant handles while editing: drag a plant to move it.
  useEffect(() => {
    const map = mapRef.current;
    for (const m of handlesRef.current) m.remove();
    handlesRef.current = [];
    if (!map || !ready || !props.editing) return;
    handlesRef.current = props.plants
      .filter((p) => p.at)
      .map((p) => {
        const el = document.createElement("div");
        const selected = p.id === props.selectedPlantId;
        el.className = `h-4 w-4 cursor-grab rounded-full border-2 ${selected ? "border-yellow-300" : "border-white"} shadow`;
        el.style.background = PLANT_COLOR[p.status];
        el.title = `${p.name}: drag to move`;
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          propsRef.current.onSelectPlant(p.id);
        });
        const marker = new mapboxgl.Marker({ element: el, draggable: true }).setLngLat(p.at!).addTo(map);
        marker.on("dragend", () => {
          const at = marker.getLngLat();
          propsRef.current.onPlantMove(p.id, [at.lng, at.lat]);
        });
        return marker;
      });
  }, [ready, props.plants, props.editing, props.selectedPlantId]);

  // Fly where asked.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !props.flyTo) return;
    const { center, zoom, pitch, bearing, duration } = props.flyTo;
    map.flyTo({ center, zoom, pitch, bearing, duration: duration ?? 2200, essential: true });
  }, [ready, props.flyTo]);

  if (failed) {
    return (
      <div className="relative h-full w-full">
        <ModelPlan areas={props.areas} plants={props.plants} steps={props.steps} truck={props.truck} house={props.house} selectedPlantId={props.selectedPlantId} activeStep={props.activeStep} placing={props.placing} onMapClick={props.onMapClick} onSelectPlant={props.onSelectPlant} onSelectStep={props.onSelectStep} />
        <p className="absolute left-2 top-2 rounded bg-black/60 px-2 py-1 text-xs text-white">Flat plan: the 3D map needs the Mapbox key</p>
      </div>
    );
  }
  return <div ref={containerRef} className="h-full w-full" />;
}
