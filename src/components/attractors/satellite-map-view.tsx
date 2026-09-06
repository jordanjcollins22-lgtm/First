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
import {
  housesToFeatures,
  OWNERSHIP_COLOR,
  pointColorExpression,
  pointsToFeatures,
  SOLD_COLOR,
  stageColorExpression,
  type MapHouse,
  type MapPoint,
  type PointColorMode,
} from "@/lib/house-geojson";
import { RELATIONSHIP_STAGES, STAGE_COLOR, STAGE_LABEL, type RelationshipStage } from "@/lib/house-relationship";
import type { EddmRouteFeature, EddmStreetFeature } from "@/lib/eddm";
import type { UnservedCluster } from "@/lib/eddm-clusters";
import { houseCoverage } from "@/lib/actions/house-coverage-actions";

if (env.mapboxToken) {
  mapboxgl.accessToken = env.mapboxToken;
}

interface SatelliteMapViewProps {
  waves: AttractorWave[];
  jobs: JobWithLocation[];
  /**
   * Addresses with nobody's work on them yet.
   *
   * The map has only ever drawn jobs, so a contact with an address and no job
   * — which is every contact that arrived by import — was invisible on it.
   * These are those, drawn hollow so a glance separates somewhere we have
   * worked from somewhere we merely know about.
   */
  leadProperties: { id: string; customerId: string; name: string; address: string; lat: number; lng: number }[];
  /**
   * Every house with a story -- anyone we know there, anything that happened
   * -- coloured by how far it has got with us. The canonical records, so a
   * held address that was just corrected appears here the moment it saves.
   */
  houses: MapHouse[];
  /**
   * Whether to draw every address in the county, coloured by stage: clusters
   * from a distance, one dot per door up close. Fetched once as bare points
   * and kept for the life of the page.
   */
  showAllAddresses: boolean;
  /** What the county's dots are coloured by: stage, ownership, or a recent sale. */
  pointColorMode: PointColorMode;
  /** USPS carrier routes for a ZIP, drawn as outlines with USPS's counts. */
  eddmRoutes: EddmRouteFeature[];
  /** The streets each route walks, coloured to match. */
  eddmStreets: EddmStreetFeature[];
  /** A route's outline handed to the wave form as a drawn shape. */
  onUseRouteAsWave: (points: LatLng[]) => void;
  /**
   * Whether to mark the houses no USPS route's streets reach: each as its
   * own dot, and grouped, so a few missed doors beside a route and a whole
   * development read differently.
   */
  showUnserved: boolean;
  unservedClusters: UnservedCluster[];
  /** Routes ticked for a mailing, drawn solid. */
  selectedEddmIds: string[];
  onToggleMailingRoute: (id: string) => void;
  /**
   * Ranked areas, strongest first, with an intensity from 0 to 1.
   *
   * Drawn as blobs under everything else — the point is the shape of where the
   * work is, which markers on top of it do not obscure and do not explain.
   */
  densityCells: {
    key: string;
    /** Every half-mile square the area is made of, so the drawn shape is the
     * actual run of streets rather than a rectangle around it. */
    cells: [number, number, number, number][];
    lat: number;
    lng: number;
    intensity: number;
    rank: number;
    label: string;
  }[];
  /**
   * Where we come in local results, point by point.
   *
   * Drawn over everything else on purpose: it is a question about the map
   * itself, and half of the answer is which streets the good points are on.
   */
  rankPoints: { lat: number; lng: number; rank: number | null; label: string; colour: string }[];
  visibleWaveIds: Set<string>;
  selectedWaveId: string | null;
  onSelectWave: (id: string | null) => void;
  selectedJobId: string | null;
  onSelectJob: (id: string | null) => void;
  locations: BusinessLocation[];
  areas: LocationArea[];
  showLocations: boolean;
  flyToTarget: LatLng | null;
  drawMode: "polygon" | "route" | null;
  onGeometryDrawn: (points: LatLng[]) => void;
}

const WAVES_SOURCE = "attractor-waves";
const WAVES_FILL_LAYER = "attractor-waves-fill";
const WAVES_LINE_LAYER = "attractor-waves-line";
const JOBS_SOURCE = "attractor-jobs";
const JOBS_LAYER = "attractor-jobs-circle";
const LEADS_SOURCE = "attractor-leads";
const LEADS_LAYER = "attractor-leads-circle";
const HOUSES_SOURCE = "houses-with-history";
const HOUSES_LAYER = "houses-with-history-circle";
const ALL_ADDRESSES_SOURCE = "all-addresses";
const ALL_ADDRESSES_LAYER = "all-addresses-circle";
const ALL_ADDRESSES_CLUSTER_LAYER = "all-addresses-cluster";
const EDDM_SOURCE = "eddm-routes";
const EDDM_FILL_LAYER = "eddm-routes-fill";
const EDDM_LINE_LAYER = "eddm-routes-line";
const EDDM_LABEL_LAYER = "eddm-routes-label";
const EDDM_STREETS_SOURCE = "eddm-streets";
const EDDM_STREETS_LAYER = "eddm-streets-line";
const ALL_ADDRESSES_COUNT_LAYER = "all-addresses-cluster-count";
const UNSERVED_SOURCE = "unserved-houses";
const UNSERVED_LAYER = "unserved-houses-circle";
const UNSERVED_GROUPS_SOURCE = "unserved-groups";
const UNSERVED_GROUPS_LAYER = "unserved-groups-circle";
const UNSERVED_GROUPS_LABEL_LAYER = "unserved-groups-label";
/** The colour of a house no USPS route reaches. */
const UNSERVED_COLOR = "#d946ef";
/** Below this, the county is clusters; from here, every door is its own dot. */
const CLUSTER_MAX_ZOOM = 12;
const DENSITY_SOURCE = "attractor-density";
const DENSITY_LAYER = "attractor-density-circle";
const RANK_SOURCE = "rank-grid";
const RANK_LAYER = "rank-grid-circle";
const AREAS_SOURCE = "location-areas";
const AREAS_FILL_LAYER = "location-areas-fill";
const AREAS_LINE_LAYER = "location-areas-line";
const LOCATIONS_SOURCE = "business-locations";
const LOCATIONS_LAYER = "business-locations-circle";
const LOCATIONS_LABEL_LAYER = "business-locations-label";

/** Names and addresses go into a popup as HTML, so anything that could be
 * read as markup is neutralised first. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function SatelliteMapView({
  waves,
  jobs,
  leadProperties,
  houses,
  showAllAddresses,
  pointColorMode,
  eddmRoutes,
  eddmStreets,
  onUseRouteAsWave,
  showUnserved,
  unservedClusters,
  selectedEddmIds,
  onToggleMailingRoute,
  densityCells,
  rankPoints,
  visibleWaveIds,
  selectedWaveId,
  onSelectWave,
  selectedJobId,
  onSelectJob,
  locations,
  areas,
  showLocations,
  flyToTarget,
  drawMode,
  onGeometryDrawn,
}: SatelliteMapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const loadedRef = useRef(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  /** What the "all addresses" layer wants the person to know, if anything. */
  const [allAddressesNote, setAllAddressesNote] = useState<string | null>(null);
  const onGeometryDrawnRef = useRef(onGeometryDrawn);
  const onSelectWaveRef = useRef(onSelectWave);
  const onUseRouteAsWaveRef = useRef(onUseRouteAsWave);
  const onToggleMailingRouteRef = useRef(onToggleMailingRoute);
  const selectedEddmRef = useRef<Set<string>>(new Set());
  const onSelectJobRef = useRef(onSelectJob);
  useEffect(() => {
    onUseRouteAsWaveRef.current = onUseRouteAsWave;
    onToggleMailingRouteRef.current = onToggleMailingRoute;
  }, [onUseRouteAsWave, onToggleMailingRoute]);

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

      map.addSource(DENSITY_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      // A drawn boundary rather than a soft blob: the area is a real square of
      // streets somebody is going to walk, and an outline says which streets.
      // A blur says "somewhere around here", which is not a place anybody can
      // be sent.
      map.addLayer({
        id: DENSITY_LAYER,
        type: "fill",
        source: DENSITY_SOURCE,
        paint: {
          "fill-color": [
            "interpolate",
            ["linear"],
            ["get", "intensity"],
            0,
            "#fde68a",
            0.5,
            "#f97316",
            1,
            "#b91c1c",
          ],
          // Strong enough to read over satellite imagery, which is dark and
          // busy and swallows anything gentler.
          "fill-opacity": 0.45,
        },
      });
      map.addLayer({
        id: `${DENSITY_LAYER}-outline`,
        type: "line",
        source: DENSITY_SOURCE,
        paint: {
          "line-color": "#ffffff",
          "line-width": 2,
          "line-opacity": 0.9,
        },
      });
      map.addLayer({
        id: `${DENSITY_LAYER}-rank`,
        type: "symbol",
        source: DENSITY_SOURCE,
        layout: {
          // The rank and the place, so the map is readable without holding the
          // list next to it. Placed at the polygon's centre rather than
          // repeated on every square it is made of.
          "text-field": ["concat", ["get", "rank"], ".  ", ["get", "label"]],
          "text-size": 13,
          "text-allow-overlap": true,
          "symbol-placement": "point",
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "#000000",
          "text-halo-width": 1.5,
        },
      });

      // The rank grid, added last so it sits over everything: it is a
      // question about the map itself, and half the answer is which streets
      // the good points are on.
      map.addSource(RANK_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: RANK_LAYER,
        type: "circle",
        source: RANK_SOURCE,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 11, 14, 20],
          "circle-color": ["get", "colour"],
          "circle-opacity": 0.9,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({
        id: `${RANK_LAYER}-label`,
        type: "symbol",
        source: RANK_SOURCE,
        layout: {
          "text-field": ["get", "label"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 8, 11, 14, 15],
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "rgba(0,0,0,0.55)",
          "text-halo-width": 1.2,
        },
      });

      // USPS carrier routes: outlines with the route id, under the houses so
      // the dots read on top of the shapes.
      map.addSource(EDDM_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: EDDM_FILL_LAYER,
        type: "fill",
        source: EDDM_SOURCE,
        paint: { "fill-color": ["get", "color"], "fill-opacity": 0.1 },
      });
      map.addLayer({
        id: EDDM_LINE_LAYER,
        type: "line",
        source: EDDM_SOURCE,
        paint: { "line-color": ["get", "color"], "line-width": 1.5, "line-opacity": 0.8, "line-dasharray": [3, 2] },
      });
      // The streets themselves, as USPS drew the route: the line the carrier
      // walks, and the line a door-hanger team would.
      map.addSource(EDDM_STREETS_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: EDDM_STREETS_LAYER,
        type: "line",
        source: EDDM_STREETS_SOURCE,
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1.5, 15, 3.5],
          "line-opacity": 0.9,
        },
      });
      map.addLayer({
        id: EDDM_LABEL_LAYER,
        type: "symbol",
        source: EDDM_SOURCE,
        minzoom: 11,
        layout: {
          "text-field": ["concat", ["get", "routeId"], "\n", ["to-string", ["coalesce", ["get", "total"], ""]]],
          "text-size": 11,
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Bold"],
        },
        paint: { "text-color": "#ffffff", "text-halo-color": "#7c2d12", "text-halo-width": 1.2 },
      });

      // Every address in the county, when asked for. Clustered from a
      // distance so the county reads as counts, and one coloured dot per door
      // once zoomed in far enough for a dot to be a door.
      map.addSource(ALL_ADDRESSES_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        cluster: true,
        clusterMaxZoom: CLUSTER_MAX_ZOOM,
        clusterRadius: 48,
      });
      map.addLayer({
        id: ALL_ADDRESSES_CLUSTER_LAYER,
        type: "circle",
        source: ALL_ADDRESSES_SOURCE,
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "rgba(71, 85, 105, 0.75)",
          "circle-radius": ["interpolate", ["linear"], ["get", "point_count"], 10, 12, 500, 22, 5000, 34],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#ffffff",
        },
      });
      map.addLayer({
        id: ALL_ADDRESSES_COUNT_LAYER,
        type: "symbol",
        source: ALL_ADDRESSES_SOURCE,
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-size": 11,
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Bold"],
        },
        paint: { "text-color": "#ffffff" },
      });
      map.addLayer({
        id: ALL_ADDRESSES_LAYER,
        type: "circle",
        source: ALL_ADDRESSES_SOURCE,
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 2.5, 15, 4.5, 19, 8],
          "circle-color": stageColorExpression() as mapboxgl.ExpressionSpecification,
          "circle-opacity": 0.9,
          "circle-stroke-width": 0.75,
          "circle-stroke-color": "#ffffff",
        },
      });

      // Houses no USPS route reaches: their own colour, on top of the county's
      // dots, and a ring per group with its count so a development is seen
      // from a distance.
      map.addSource(UNSERVED_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: UNSERVED_LAYER,
        type: "circle",
        source: UNSERVED_SOURCE,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2, 13, 3.5, 16, 6, 19, 9],
          "circle-color": UNSERVED_COLOR,
          "circle-opacity": 0.95,
          "circle-stroke-width": 1,
          "circle-stroke-color": "#4a044e",
        },
      });
      map.addSource(UNSERVED_GROUPS_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: UNSERVED_GROUPS_LAYER,
        type: "circle",
        source: UNSERVED_GROUPS_SOURCE,
        maxzoom: 15,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "houses"], 1, 8, 5, 12, 50, 20, 300, 30],
          "circle-color": ["case", ["==", ["get", "kind"], "development"], "rgba(217, 70, 239, 0.35)", "rgba(217, 70, 239, 0.15)"],
          "circle-stroke-width": ["case", ["==", ["get", "kind"], "development"], 2.5, 1.5],
          "circle-stroke-color": UNSERVED_COLOR,
        },
      });
      map.addLayer({
        id: UNSERVED_GROUPS_LABEL_LAYER,
        type: "symbol",
        source: UNSERVED_GROUPS_SOURCE,
        maxzoom: 15,
        layout: {
          "text-field": ["to-string", ["get", "houses"]],
          "text-size": 11,
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Bold"],
          "text-allow-overlap": true,
        },
        paint: { "text-color": "#ffffff", "text-halo-color": "#4a044e", "text-halo-width": 1.2 },
      });

      map.addSource(LEADS_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: LEADS_LAYER,
        type: "circle",
        source: LEADS_SOURCE,
        paint: {
          "circle-radius": 4,
          // Hollow: somewhere we know about rather than somewhere we have
          // worked. Filled dots are jobs, and the difference has to survive a
          // glance at a phone in a truck.
          "circle-color": "#ffffff",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#7c3aed",
          "circle-opacity": 0.9,
        },
      });

      // Houses with a story, coloured by stage. Above the lead markers so a
      // corrected address shows in its true colour rather than as a hollow dot.
      map.addSource(HOUSES_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: HOUSES_LAYER,
        type: "circle",
        source: HOUSES_SOURCE,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 4, 14, 6, 18, 9],
          "circle-color": ["get", "color"],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#ffffff",
          "circle-opacity": 0.95,
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
      map.on("click", LEADS_LAYER, (e) => {
        const feature = e.features?.[0];
        const point = feature?.geometry as GeoJSON.Point | undefined;
        if (!feature || !point) return;
        const { customerId, name, address } = feature.properties as {
          customerId: string;
          name: string;
          address: string;
        };
        new mapboxgl.Popup({ offset: 10 })
          .setLngLat(point.coordinates as [number, number])
          .setHTML(
            `<div style="font:500 13px system-ui"><div>${escapeHtml(name)}</div>` +
              `<div style="color:#666;font-weight:400">${escapeHtml(address)}</div>` +
              `<a href="/clients/${customerId}" style="color:#2f6d3c;text-decoration:underline">Open contact</a></div>`
          )
          .addTo(map);
      });
      map.on("mouseenter", LEADS_LAYER, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", LEADS_LAYER, () => {
        map.getCanvas().style.cursor = "";
      });

      map.on("click", HOUSES_LAYER, (e) => {
        const feature = e.features?.[0];
        const point = feature?.geometry as GeoJSON.Point | undefined;
        if (!feature || !point) return;
        const { address, stage, contacts, customerId } = feature.properties as {
          address: string;
          stage: RelationshipStage;
          contacts: string;
          customerId: string | null;
        };
        const link = customerId
          ? `<a href="/clients/${escapeHtml(customerId)}" style="color:#2f6d3c;text-decoration:underline">Open contact</a>`
          : "";
        new mapboxgl.Popup({ offset: 10 })
          .setLngLat(point.coordinates as [number, number])
          .setHTML(
            `<div style="font:500 13px system-ui"><div>${escapeHtml(address)}</div>` +
              `<div style="color:#666;font-weight:400">${escapeHtml(STAGE_LABEL[stage] ?? stage)}` +
              `${contacts ? ` · ${escapeHtml(contacts)}` : ""}</div>${link}</div>`
          )
          .addTo(map);
      });
      map.on("mouseenter", HOUSES_LAYER, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", HOUSES_LAYER, () => (map.getCanvas().style.cursor = ""));

      map.on("click", ALL_ADDRESSES_CLUSTER_LAYER, (e) => {
        const feature = e.features?.[0];
        const point = feature?.geometry as GeoJSON.Point | undefined;
        const clusterId = feature?.properties?.cluster_id;
        const source = map.getSource(ALL_ADDRESSES_SOURCE) as mapboxgl.GeoJSONSource | undefined;
        if (!feature || !point || clusterId == null || !source) return;
        source.getClusterExpansionZoom(clusterId, (err, zoom) => {
          if (err || zoom == null) return;
          map.easeTo({ center: point.coordinates as [number, number], zoom: Math.min(zoom, 18) });
        });
      });
      map.on("mouseenter", ALL_ADDRESSES_CLUSTER_LAYER, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", ALL_ADDRESSES_CLUSTER_LAYER, () => (map.getCanvas().style.cursor = ""));

      map.on("click", ALL_ADDRESSES_LAYER, async (e) => {
        const feature = e.features?.[0];
        const point = feature?.geometry as GeoJSON.Point | undefined;
        if (!feature || !point) return;
        const [lng, lat] = point.coordinates as [number, number];
        const rank = Number((feature.properties as { s?: number }).s ?? 0);
        const stage = RELATIONSHIP_STAGES[rank] ?? "untouched";
        const popup = new mapboxgl.Popup({ offset: 8 })
          .setLngLat([lng, lat])
          .setHTML(`<div style="font:500 13px system-ui"><div style="color:#666">${escapeHtml(STAGE_LABEL[stage])}</div><div>Looking up the address…</div></div>`)
          .addTo(map);
        // The points carry no address, to keep a hundred thousand of them
        // small; the one that was clicked is looked up on demand.
        const d = 0.00012;
        const params = new URLSearchParams({
          minLat: String(lat - d),
          minLng: String(lng - d),
          maxLat: String(lat + d),
          maxLng: String(lng + d),
        });
        try {
          const res = await fetch(`/api/houses/geojson?${params}`, { cache: "no-store" });
          const body = (await res.json()) as { features?: { properties: { address: string } }[] };
          const address = body.features?.[0]?.properties.address ?? "Address not found";
          popup.setHTML(
            `<div style="font:500 13px system-ui"><div>${escapeHtml(address)}</div>` +
              `<div style="color:#666;font-weight:400">${escapeHtml(STAGE_LABEL[stage])}</div></div>`
          );
        } catch {
          popup.setHTML(`<div style="font:500 13px system-ui">${escapeHtml(STAGE_LABEL[stage])}</div>`);
        }
      });
      map.on("mouseenter", ALL_ADDRESSES_LAYER, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", ALL_ADDRESSES_LAYER, () => (map.getCanvas().style.cursor = ""));

      map.on("click", UNSERVED_GROUPS_LAYER, (e) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const props = feature.properties as { houses: number; kind: string; sample: string; zip: string | null };
        const what =
          props.kind === "development"
            ? "Likely a new development: no USPS route reaches these yet"
            : "A few doors no route's streets pass: take them in on the nearest walk";
        new mapboxgl.Popup({ offset: 6, maxWidth: "280px" })
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font:500 13px system-ui"><div>${Number(props.houses).toLocaleString()} houses off any USPS route</div>` +
              `<div style="color:#666;font-weight:400">${escapeHtml(what)}</div>` +
              `<div style="color:#666;font-weight:400">Near ${escapeHtml(props.sample ?? "")}${props.zip ? `, ${escapeHtml(props.zip)}` : ""}</div></div>`
          )
          .addTo(map);
      });
      map.on("mouseenter", UNSERVED_GROUPS_LAYER, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", UNSERVED_GROUPS_LAYER, () => (map.getCanvas().style.cursor = ""));
      map.on("click", UNSERVED_LAYER, (e) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const props = feature.properties as { address: string };
        new mapboxgl.Popup({ offset: 6, maxWidth: "260px" })
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font:500 13px system-ui"><div>${escapeHtml(props.address ?? "")}</div>` +
              `<div style="color:#666;font-weight:400">No USPS route's streets come within 60 m</div></div>`
          )
          .addTo(map);
      });
      map.on("mouseenter", UNSERVED_LAYER, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", UNSERVED_LAYER, () => (map.getCanvas().style.cursor = ""));

      map.on("click", EDDM_FILL_LAYER, async (e) => {
        // A dot on top of a route is about the dot.
        if (map.queryRenderedFeatures(e.point, { layers: [HOUSES_LAYER, ALL_ADDRESSES_LAYER, JOBS_LAYER] }).length > 0) return;
        const feature = e.features?.[0];
        if (!feature) return;
        const props = feature.properties as {
          id: string;
          zip: string;
          routeId: string;
          residential: number | null;
          business: number | null;
          total: number | null;
          medianIncome: number | null;
          medianAge: number | null;
          householdSize: number | null;
          under200: boolean;
          walkability: string;
          walkabilityReason: string | null;
          houseCount: number | null;
          waveId: string | null;
        };
        const inMailing = selectedEddmRef.current.has(props.id);
        const walk =
          props.walkability === "hard"
            ? `<div style="color:#dc2626;font-weight:500">Hard to walk${props.walkabilityReason ? `: ${escapeHtml(props.walkabilityReason)}` : ""}</div>`
            : props.walkability === "walkable"
              ? `<div style="color:#15803d;font-weight:500">Walkable${props.waveId ? " · door-hanger wave made" : ""}${props.houseCount != null ? ` · ${Number(props.houseCount).toLocaleString()} of our houses on it` : ""}</div>`
              : "";
        const polygon = feature.geometry as GeoJSON.Polygon;
        const outer = polygon.coordinates[0] ?? [];
        const points: LatLng[] = outer.map(([lng, lat]) => ({ lat, lng }));
        const usps = [
          props.residential != null ? `${Number(props.residential).toLocaleString()} residential` : null,
          props.business != null ? `${Number(props.business).toLocaleString()} business` : null,
          props.total != null ? `${Number(props.total).toLocaleString()} total deliveries` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        const people = [
          props.medianIncome != null ? `median income $${Number(props.medianIncome).toLocaleString()}` : null,
          props.medianAge != null ? `median age ${props.medianAge}` : null,
          props.householdSize != null ? `${props.householdSize} per household` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        const under200 = props.under200 ? `<div style="color:#b45309;font-weight:500">Under 200 deliveries: below the EDDM minimum</div>` : "";
        const popup = new mapboxgl.Popup({ offset: 6, maxWidth: "300px" })
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font:500 13px system-ui"><div>USPS route ${escapeHtml(props.zip)} ${escapeHtml(props.routeId)}</div>` +
              `<div style="color:#666;font-weight:400">${escapeHtml(usps || "No USPS counts")}</div>` +
              (people ? `<div style="color:#666;font-weight:400">${escapeHtml(people)}</div>` : "") +
              under200 +
              walk +
              `<div id="eddm-ours" style="color:#666;font-weight:400">Counting our houses…</div>` +
              `<div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">` +
              `<button type="button" data-act="mail" style="padding:4px 8px;border-radius:6px;background:${inMailing ? "#b45309" : "#1d4ed8"};color:#fff;font:500 12px system-ui">${inMailing ? "Remove from mailing" : "Add to mailing"}</button>` +
              `<button type="button" data-act="wave" style="padding:4px 8px;border-radius:6px;background:#2f6d3c;color:#fff;font:500 12px system-ui">Use as a wave area</button>` +
              `</div></div>`
          )
          .addTo(map);
        popup.getElement()?.querySelector("button[data-act=wave]")?.addEventListener("click", () => {
          onUseRouteAsWaveRef.current(points);
          popup.remove();
        });
        popup.getElement()?.querySelector("button[data-act=mail]")?.addEventListener("click", () => {
          onToggleMailingRouteRef.current(props.id);
          popup.remove();
        });
        // Our own count inside the same outline, beside USPS's.
        const result = await houseCoverage("polygon", { points });
        const ours = popup.getElement()?.querySelector("#eddm-ours");
        if (!ours) return;
        if (result.ok && result.value) {
          const clients = result.value.byStage.client + result.value.byStage.job_completed;
          ours.textContent = `Ours: ${result.value.total.toLocaleString()} houses, ${clients} clients, ${result.value.toHang.toLocaleString()} to hang`;
        } else {
          ours.textContent = "Our count is unavailable";
        }
      });
      map.on("mouseenter", EDDM_FILL_LAYER, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", EDDM_FILL_LAYER, () => (map.getCanvas().style.cursor = ""));

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

  // Keep the density blobs in sync.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const source = map.getSource(DENSITY_SOURCE) as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;

    source.setData({
      type: "FeatureCollection",
      features: densityCells.map((c) => ({
        type: "Feature" as const,
        geometry: {
          type: "MultiPolygon" as const,
          coordinates: c.cells.map(([west, south, east, north]) => [
            [
              [west, south],
              [east, south],
              [east, north],
              [west, north],
              [west, south],
            ],
          ]),
        },
        properties: { intensity: c.intensity, rank: String(c.rank), label: c.label },
      })),
    });
  }, [densityCells, mapLoaded]);

  // Keep the rank grid in sync.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const source = map.getSource(RANK_SOURCE) as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;

    source.setData({
      type: "FeatureCollection",
      features: rankPoints.map((point) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [point.lng, point.lat] },
        properties: { label: point.label, colour: point.colour },
      })),
    });
  }, [rankPoints, mapLoaded]);

  // Keep the lead markers in sync.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const source = map.getSource(LEADS_SOURCE) as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;

    source.setData({
      type: "FeatureCollection",
      features: leadProperties.map((p) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
        properties: { customerId: p.customerId, name: p.name, address: p.address },
      })),
    });
  }, [leadProperties, mapLoaded]);

  // Keep the houses with a story in sync.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const source = map.getSource(HOUSES_SOURCE) as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;
    source.setData({ type: "FeatureCollection", features: housesToFeatures(houses) });
  }, [houses, mapLoaded]);

  // Routes in the mailing are drawn solid; the rest stay faint.
  useEffect(() => {
    selectedEddmRef.current = new Set(selectedEddmIds);
    const map = mapRef.current;
    if (!map || !loadedRef.current || !map.getLayer(EDDM_FILL_LAYER)) return;
    map.setPaintProperty(EDDM_FILL_LAYER, "fill-opacity", [
      "case",
      ["in", ["get", "id"], ["literal", selectedEddmIds]],
      0.4,
      0.1,
    ]);
    map.setPaintProperty(EDDM_LINE_LAYER, "line-width", [
      "case",
      ["in", ["get", "id"], ["literal", selectedEddmIds]],
      3,
      1.5,
    ]);
  }, [selectedEddmIds, mapLoaded]);

  // Keep the USPS routes and their streets in sync.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const routes = map.getSource(EDDM_SOURCE) as mapboxgl.GeoJSONSource | undefined;
    const streets = map.getSource(EDDM_STREETS_SOURCE) as mapboxgl.GeoJSONSource | undefined;
    routes?.setData({ type: "FeatureCollection", features: eddmRoutes });
    streets?.setData({ type: "FeatureCollection", features: eddmStreets });
  }, [eddmRoutes, eddmStreets, mapLoaded]);

  // The county's dots take their colour from whichever the person asked for.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || !map.getLayer(ALL_ADDRESSES_LAYER)) return;
    map.setPaintProperty(ALL_ADDRESSES_LAYER, "circle-color", pointColorExpression(pointColorMode) as mapboxgl.ExpressionSpecification);
  }, [pointColorMode, mapLoaded]);

  // Every address in the county, fetched once and kept, while asked for.
  const allPointsRef = useRef<MapPoint[] | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const source = map.getSource(ALL_ADDRESSES_SOURCE) as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;

    if (!showAllAddresses) {
      source.setData({ type: "FeatureCollection", features: [] });
      return;
    }

    let cancelled = false;
    async function load() {
      if (!allPointsRef.current) {
        setAllAddressesNote("Loading every address in the county…");
        try {
          const res = await fetch("/api/houses/all");
          if (!res.ok) throw new Error(`${res.status}`);
          const body = (await res.json()) as { points: MapPoint[] };
          allPointsRef.current = body.points;
        } catch {
          if (!cancelled) setAllAddressesNote("Could not load the county's addresses");
          return;
        }
      }
      if (cancelled) return;
      const features = pointsToFeatures(allPointsRef.current);
      source?.setData({ type: "FeatureCollection", features });
      setAllAddressesNote(`${features.length.toLocaleString()} addresses. Zoom in for one dot per door.`);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [showAllAddresses, mapLoaded]);

  // The houses no route reaches, fetched once when asked for; the groups
  // come with the page.
  const unservedRef = useRef<[number, number, string, string][] | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const points = map.getSource(UNSERVED_SOURCE) as mapboxgl.GeoJSONSource | undefined;
    const groups = map.getSource(UNSERVED_GROUPS_SOURCE) as mapboxgl.GeoJSONSource | undefined;
    if (!points || !groups) return;
    if (!showUnserved) {
      points.setData({ type: "FeatureCollection", features: [] });
      groups.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    groups.setData({
      type: "FeatureCollection",
      features: unservedClusters.map((c) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [c.lng, c.lat] },
        properties: { houses: c.houses, kind: c.kind, sample: c.sample, zip: c.zip },
      })),
    });
    let cancelled = false;
    async function load() {
      if (!unservedRef.current) {
        try {
          const res = await fetch("/api/houses/unserved");
          if (!res.ok) throw new Error(`${res.status}`);
          const body = (await res.json()) as { points: [number, number, string, string][] };
          unservedRef.current = body.points;
        } catch {
          return;
        }
      }
      if (cancelled) return;
      points?.setData({
        type: "FeatureCollection",
        features: unservedRef.current.map(([lng, lat, id, address]) => ({
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [lng, lat] },
          properties: { id, address },
        })),
      });
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [showUnserved, unservedClusters, mapLoaded]);

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

  // Fly to a target location (e.g. a selected property) when requested.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || !flyToTarget) return;
    map.flyTo({ center: [flyToTarget.lng, flyToTarget.lat], zoom: Math.max(map.getZoom(), 18), duration: 800 });
  }, [flyToTarget, mapLoaded]);

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

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {(showAllAddresses || showUnserved || houses.length > 0) && (
        <div className="pointer-events-none absolute bottom-3 right-3 flex flex-col gap-0.5 rounded-md bg-black/60 px-2 py-1.5 text-[11px] text-white">
          {(pointColorMode === "stage" || !showAllAddresses) &&
            RELATIONSHIP_STAGES.map((stage) => (
              <span key={stage} className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: STAGE_COLOR[stage] }} />
                {STAGE_LABEL[stage]}
              </span>
            ))}
          {showAllAddresses && pointColorMode === "ownership" && (
            <>
              <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: OWNERSHIP_COLOR.ownerOccupied }} />Owner lives there</span>
              <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: OWNERSHIP_COLOR.absentee }} />Absentee or rented</span>
              <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: OWNERSHIP_COLOR.unknown }} />Not on the roll</span>
            </>
          )}
          {showAllAddresses && pointColorMode === "sold" && (
            <>
              <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: SOLD_COLOR.recent }} />Sold in the last year</span>
              <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: SOLD_COLOR.other }} />Everything else</span>
            </>
          )}
          {showUnserved && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: UNSERVED_COLOR }} />
              Off any USPS route
            </span>
          )}
        </div>
      )}
      {showAllAddresses && allAddressesNote && (
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-black/60 px-2 py-1 text-xs text-white">
          {allAddressesNote}
        </div>
      )}
    </div>
  );
}
