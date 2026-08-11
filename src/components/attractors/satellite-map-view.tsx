"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import "mapbox-gl/dist/mapbox-gl.css";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";

import { env } from "@/lib/env";
import { geometryPoints, geometryToPolygon, waveToPolygon } from "@/lib/attractor-geometry";
import { colorForAttractorType, colorForJobStatus, LOCATION_COLOR } from "./attractor-colors";
import type { AttractorWave, BusinessLocation, LatLng, LocationArea } from "@/types/domain";
import type { JobWithLocation } from "@/lib/data/jobs";

if (env.mapboxToken) {
  mapboxgl.accessToken = env.mapboxToken;
}

interface SatelliteMapViewProps {
  waves: AttractorWave[];
  jobs: JobWithLocation[];
  visibleWaveIds: Set<string>;
  selectedWaveId: string | null;
  onSelectWave: (id: string | null) => void;
  selectedJobId: string | null;
  onSelectJob: (id: string | null) => void;
  locations: BusinessLocation[];
  areas: LocationArea[];
  showLocations: boolean;
  drawMode: "polygon" | "route" | null;
  onGeometryDrawn: (points: LatLng[]) => void;
}

const WAVES_SOURCE = "attractor-waves";
const WAVES_FILL_LAYER = "attractor-waves-fill";
const WAVES_LINE_LAYER = "attractor-waves-line";
const JOBS_SOURCE = "attractor-jobs";
const JOBS_LAYER = "attractor-jobs-circle";
const AREAS_SOURCE = "location-areas";
const AREAS_FILL_LAYER = "location-areas-fill";
const AREAS_LINE_LAYER = "location-areas-line";
const LOCATIONS_SOURCE = "business-locations";
const LOCATIONS_LAYER = "business-locations-circle";
const LOCATIONS_LABEL_LAYER = "business-locations-label";

export function SatelliteMapView({
  waves,
  jobs,
  visibleWaveIds,
  selectedWaveId,
  onSelectWave,
  selectedJobId,
  onSelectJob,
  locations,
  areas,
  showLocations,
  drawMode,
  onGeometryDrawn,
}: SatelliteMapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const loadedRef = useRef(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const onGeometryDrawnRef = useRef(onGeometryDrawn);
  const onSelectWaveRef = useRef(onSelectWave);
  const onSelectJobRef = useRef(onSelectJob);

  useEffect(() => {
    onGeometryDrawnRef.current = onGeometryDrawn;
    onSelectWaveRef.current = onSelectWave;
    onSelectJobRef.current = onSelectJob;
  });

  // Mount the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const points: [number, number][] = [
      ...waves.flatMap((w) => geometryPoints(w.geometry_type, w.geometry).map((p) => [p.lng, p.lat] as [number, number])),
      ...jobs.map((j) => [j.property.lng, j.property.lat] as [number, number]),
      ...locations.map((l) => [l.lng, l.lat] as [number, number]),
      ...areas.flatMap((a) => geometryPoints(a.geometry_type, a.geometry).map((p) => [p.lng, p.lat] as [number, number])),
    ];

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: points.length > 0 ? points[0] : [-98.5795, 39.8283],
      zoom: points.length > 0 ? 12 : 3,
    });
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl(), "top-right");

    map.on("load", () => {
      if (points.length > 1) {
        const bounds = points.reduce(
          (b, p) => b.extend(p),
          new mapboxgl.LngLatBounds(points[0], points[0])
        );
        map.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: 0 });
      }

      map.addSource(WAVES_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: WAVES_FILL_LAYER,
        type: "fill",
        source: WAVES_SOURCE,
        paint: {
          "fill-color": ["get", "color"],
          "fill-opacity": ["case", ["==", ["get", "selected"], true], 0.5, 0.25],
        },
      });
      map.addLayer({
        id: WAVES_LINE_LAYER,
        type: "line",
        source: WAVES_SOURCE,
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["case", ["==", ["get", "selected"], true], 3, 1.5],
        },
      });

      map.addSource(JOBS_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: JOBS_LAYER,
        type: "circle",
        source: JOBS_SOURCE,
        paint: {
          "circle-radius": ["case", ["==", ["get", "selected"], true], 9, 6],
          "circle-color": ["get", "color"],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });

      map.addSource(AREAS_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: AREAS_FILL_LAYER,
        type: "fill",
        source: AREAS_SOURCE,
        paint: { "fill-color": LOCATION_COLOR, "fill-opacity": 0.12 },
      });
      map.addLayer({
        id: AREAS_LINE_LAYER,
        type: "line",
        source: AREAS_SOURCE,
        paint: { "line-color": LOCATION_COLOR, "line-width": 1.5, "line-dasharray": [2, 2] },
      });

      map.addSource(LOCATIONS_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: LOCATIONS_LAYER,
        type: "circle",
        source: LOCATIONS_SOURCE,
        paint: {
          "circle-radius": 9,
          "circle-color": LOCATION_COLOR,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });
      map.addLayer({
        id: LOCATIONS_LABEL_LAYER,
        type: "symbol",
        source: LOCATIONS_SOURCE,
        layout: {
          "text-field": ["get", "name"],
          "text-offset": [0, 1.4],
          "text-anchor": "top",
          "text-size": 12,
        },
        paint: { "text-color": "#ffffff", "text-halo-color": "#000000", "text-halo-width": 1.2 },
      });

      map.on("click", WAVES_FILL_LAYER, (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (id) onSelectWaveRef.current(id);
      });
      map.on("click", JOBS_LAYER, (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (id) onSelectJobRef.current(id);
        const coords = e.features?.[0]?.geometry as GeoJSON.Point | undefined;
        if (coords?.coordinates) {
          map.flyTo({ center: coords.coordinates as [number, number], zoom: Math.max(map.getZoom(), 17), duration: 800 });
        }
      });
      map.on("mouseenter", WAVES_FILL_LAYER, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", WAVES_FILL_LAYER, () => (map.getCanvas().style.cursor = ""));
      map.on("mouseenter", JOBS_LAYER, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", JOBS_LAYER, () => (map.getCanvas().style.cursor = ""));

      loadedRef.current = true;
      setMapLoaded(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      loadedRef.current = false;
      setMapLoaded(false);
    };
    // Runs once on mount — later prop changes update the map's data sources
    // via the effects below instead of remounting the whole map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the wave overlay source in sync with the current waves/visibility/selection.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const source = map.getSource(WAVES_SOURCE) as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;

    const features = waves
      .filter((w) => visibleWaveIds.has(w.id))
      .map((w) => {
        const polygon = waveToPolygon(w);
        if (!polygon) return null;
        return {
          ...polygon,
          properties: {
            id: w.id,
            color: colorForAttractorType(w.type_id),
            selected: w.id === selectedWaveId,
          },
        };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);

    source.setData({ type: "FeatureCollection", features });
  }, [waves, visibleWaveIds, selectedWaveId, mapLoaded]);

  // Keep the job markers in sync.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const source = map.getSource(JOBS_SOURCE) as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;

    const features = jobs.map((j) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [j.property.lng, j.property.lat] },
      properties: {
        id: j.id,
        color: colorForJobStatus(j.status),
        selected: j.id === selectedJobId,
      },
    }));

    source.setData({ type: "FeatureCollection", features });
  }, [jobs, selectedJobId, mapLoaded]);

  // Keep the business-location stars and their service-area overlays in sync.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const areasSource = map.getSource(AREAS_SOURCE) as mapboxgl.GeoJSONSource | undefined;
    const locationsSource = map.getSource(LOCATIONS_SOURCE) as mapboxgl.GeoJSONSource | undefined;
    if (!areasSource || !locationsSource) return;

    if (!showLocations) {
      areasSource.setData({ type: "FeatureCollection", features: [] });
      locationsSource.setData({ type: "FeatureCollection", features: [] });
      return;
    }

    const areaFeatures = areas
      .map((a) => geometryToPolygon(a.geometry_type, a.geometry))
      .filter((f): f is NonNullable<typeof f> => f !== null);
    areasSource.setData({ type: "FeatureCollection", features: areaFeatures });

    const locationFeatures = locations.map((l) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [l.lng, l.lat] },
      properties: { id: l.id, name: l.name },
    }));
    locationsSource.setData({ type: "FeatureCollection", features: locationFeatures });
  }, [locations, areas, showLocations, mapLoaded]);

  // Enter/exit draw mode for capturing a polygon or route from the user.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;

    if (!drawMode) {
      if (drawRef.current) {
        map.removeControl(drawRef.current);
        drawRef.current = null;
      }
      return;
    }

    const draw = new MapboxDraw({ displayControlsDefault: false });
    drawRef.current = draw;
    map.addControl(draw);
    if (drawMode === "polygon") draw.changeMode("draw_polygon");
    else draw.changeMode("draw_line_string");

    function handleCreate(e: { features: GeoJSON.Feature[] }) {
      const feature = e.features[0];
      if (!feature) return;
      let coords: number[][] = [];
      if (feature.geometry.type === "Polygon") {
        coords = feature.geometry.coordinates[0].slice(0, -1);
      } else if (feature.geometry.type === "LineString") {
        coords = feature.geometry.coordinates;
      }
      onGeometryDrawnRef.current(coords.map(([lng, lat]) => ({ lat, lng })));
      draw.deleteAll();
    }

    map.on("draw.create", handleCreate);
    return () => {
      map.off("draw.create", handleCreate);
      if (drawRef.current === draw) {
        map.removeControl(draw);
        drawRef.current = null;
      }
    };
  }, [drawMode]);

  return <div ref={containerRef} className="h-full w-full" />;
}
