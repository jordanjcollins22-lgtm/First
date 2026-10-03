/**
 * Reading USPS's EDDM map service.
 *
 * Every Door Direct Mail is sold by carrier route, and USPS draws the routes
 * on its own map from an ArcGIS server at gis.usps.com. There is no documented
 * API; what there is, is the request that map makes -- a geoprocessing task
 * that takes a ZIP and answers with the routes in it as a feature set.
 *
 * What it answers with is not what one would guess. A route is not a
 * boundary: it is the streets the carrier walks, a bundle of short line
 * segments each carrying the route's counts. The first live answer for ZIP
 * 21014 was thirty routes of polylines and not one polygon. So the streets are
 * kept as they came, and the boundary the map draws -- and hands to the wave
 * form -- is worked out from them: a hull around the street network, pushed
 * out far enough to take in the houses that stand back from the kerb.
 *
 * Nothing here assumes a field name; the attributes are searched for the
 * route id and the counts under the several names USPS has used, and the
 * geometry is accepted in either of the two projections it has come back in.
 * Kept pure: what USPS answers is written to the database with the request
 * that produced it, so when the service changes shape the change is visible
 * there rather than as a map with no routes on it.
 */

import * as turf from "@turf/turf";

export type LngLatPair = [number, number];

export interface EddmRoute {
  zip: string;
  routeId: string;
  residential: number | null;
  business: number | null;
  total: number | null;
  /** Rings of [lng, lat], WGS84: the boundary, worked out or given. */
  rings: LngLatPair[][];
  /** The streets the carrier walks, as USPS sent them. */
  paths: LngLatPair[][];
  attributes: Record<string, unknown>;
  /** Filled in by the build: whether a door-hanger team can walk it, and why not. */
  walkability?: "walkable" | "hard" | "unknown";
  walkabilityReason?: string | null;
  routeType?: string | null;
  /** How many of our houses sit on the route's streets. */
  houseCount?: number;
  /** The Door Hangers wave made from the route, when there is one. */
  waveId?: string | null;
}

/** The request the EDDM map makes for one ZIP, with the answer asked for in WGS84. */
export const DEFAULT_EDDM_ROUTES_URL =
  "https://gis.usps.com/arcgis/rest/services/EDDM/selectZIP/GPServer/routes/execute?f=json&env:outSR=4326&Rte_Box=R&UserName=EDDM&Zip={zip}";

/** The catalog above it, for the connection test. */
export const DEFAULT_EDDM_ROOT = "https://gis.usps.com/arcgis/rest/services/EDDM";

export function eddmRoutesUrl(zip: string, template = DEFAULT_EDDM_ROUTES_URL): string {
  const clean = zip.replace(/\D/g, "").slice(0, 5);
  return template.replace("{zip}", encodeURIComponent(clean));
}

const ROUTE_ID_FIELDS = ["CRID_ID", "CRID", "ROUTE_ID", "ROUTEID", "RTE_ID", "CARRIER_ROUTE", "ROUTE", "CR"];
const ZIP_FIELDS = ["ZIP_CODE", "ZIP", "ZIP5", "ZIPCODE"];
const RES_FIELDS = ["RES_CNT", "RESIDENTIAL", "RES_COUNT", "RESCNT", "RESIDENTIAL_COUNT"];
const BUS_FIELDS = ["BUS_CNT", "BUSINESS", "BUS_COUNT", "BUSCNT", "BUSINESS_COUNT"];
const TOT_FIELDS = ["TOT_CNT", "TOTAL", "TOTAL_CNT", "TOTCNT", "TOTAL_COUNT"];

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);

function pick(attributes: Dict, candidates: string[]): unknown {
  const byUpper = new Map(Object.keys(attributes).map((k) => [k.toUpperCase(), k]));
  for (const c of candidates) {
    const key = byUpper.get(c);
    if (key !== undefined && attributes[key] != null && attributes[key] !== "") return attributes[key];
  }
  return undefined;
}

function asText(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function asCount(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Math.round(Number(v));
  return null;
}

/** Web Mercator metres to degrees, for a server that ignored the projection asked for. */
export function mercatorToLngLat(x: number, y: number): LngLatPair {
  const R = 6378137;
  const lng = (x / R) * (180 / Math.PI);
  const lat = (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI);
  return [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6];
}

/** Whether a coordinate pair can only be metres, not degrees. */
function looksProjected(x: number, y: number): boolean {
  return Math.abs(x) > 180 || Math.abs(y) > 90;
}

function linesOf(raw: unknown, minPoints: number): LngLatPair[][] {
  if (!Array.isArray(raw)) return [];
  const out: LngLatPair[][] = [];
  for (const line of raw) {
    if (!Array.isArray(line)) continue;
    const points: LngLatPair[] = [];
    for (const vertex of line) {
      if (!Array.isArray(vertex)) continue;
      const x = Number(vertex[0]);
      const y = Number(vertex[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      points.push(looksProjected(x, y) ? mercatorToLngLat(x, y) : [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6]);
    }
    if (points.length >= minPoints) out.push(points);
  }
  return out;
}

/** How far past the kerb the boundary reaches, so houses set back from the street are inside it. */
const SETBACK_KM = 0.06;
/** The longest edge a concave hull may take; longer gaps between streets are not one neighbourhood. */
const HULL_EDGE_KM = 0.4;

/**
 * A boundary for a route USPS only drew as streets.
 *
 * A concave hull around every vertex of every segment, then pushed out sixty
 * metres so the houses along the streets fall inside it. Where a hull cannot
 * be formed -- too few points, or streets that do not close -- the streets
 * themselves are buffered instead, which is looser but never empty.
 */
export function routeBoundary(paths: LngLatPair[][]): LngLatPair[][] {
  const vertices = paths.flat();
  if (vertices.length < 3) return [];

  let shape: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null = null;
  try {
    const points = turf.featureCollection(vertices.map((v) => turf.point(v)));
    const hull = turf.concave(points, { maxEdge: HULL_EDGE_KM, units: "kilometers" }) ?? turf.convex(points);
    if (hull) shape = turf.buffer(hull, SETBACK_KM, { units: "kilometers" }) ?? null;
  } catch {
    shape = null;
  }
  if (!shape) {
    try {
      const streets = turf.multiLineString(paths.filter((p) => p.length >= 2));
      shape = turf.buffer(streets, SETBACK_KM, { units: "kilometers" }) ?? null;
    } catch {
      shape = null;
    }
  }
  if (!shape) return [];

  const simplified = turf.simplify(shape, { tolerance: 0.00003, highQuality: false });
  const polygons =
    simplified.geometry.type === "Polygon" ? [simplified.geometry.coordinates] : simplified.geometry.coordinates;
  // Outer rings only, largest first. Holes in a walking area are streets the
  // carrier does not serve, which is a distinction for USPS and not for us.
  return polygons
    .map((rings) => rings[0].map(([lng, lat]) => [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6] as LngLatPair))
    .filter((ring) => ring.length >= 4)
    .sort((a, b) => b.length - a.length);
}

/**
 * The features in a response, wherever the server put them.
 *
 * A geoprocessing task wraps its answer in `results[].value.features`; a plain
 * layer query answers with `features` at the top. Both are accepted, so the
 * template URL can point at either without a code change.
 */
export function featuresIn(body: unknown): Dict[] {
  if (!isDict(body)) return [];
  if (Array.isArray(body.features)) return body.features.filter(isDict);
  if (Array.isArray(body.results)) {
    const out: Dict[] = [];
    for (const result of body.results) {
      if (!isDict(result) || !isDict(result.value)) continue;
      const features = result.value.features;
      if (Array.isArray(features)) out.push(...features.filter(isDict));
    }
    return out;
  }
  return [];
}

/** The error a server reports inside a 200, if any. */
export function eddmError(body: unknown): string | null {
  if (!isDict(body)) return "The server answered with something that was not JSON.";
  if (isDict(body.error)) {
    const message = typeof body.error.message === "string" ? body.error.message : "The server returned an error.";
    const details = Array.isArray(body.error.details) ? body.error.details.filter((d) => typeof d === "string").join(" ") : "";
    return details ? `${message} ${details}` : message;
  }
  return null;
}

/**
 * Every route in a response, with what we could read of it.
 *
 * A route may arrive as rings (a boundary) or as paths (its streets). Given
 * streets and no boundary, the boundary is worked out. Given neither, there
 * is nothing to draw and the route is left out.
 */
export function parseEddmRoutes(body: unknown, fallbackZip: string): EddmRoute[] {
  const routes: EddmRoute[] = [];
  for (const feature of featuresIn(body)) {
    const attributes = isDict(feature.attributes) ? feature.attributes : {};
    const routeId = asText(pick(attributes, ROUTE_ID_FIELDS));
    const geometry = isDict(feature.geometry) ? feature.geometry : {};
    const givenRings = linesOf(geometry.rings, 4);
    const paths = linesOf(geometry.paths, 2);
    const rings = givenRings.length > 0 ? givenRings : routeBoundary(paths);
    if (!routeId || rings.length === 0) continue;
    routes.push({
      zip: asText(pick(attributes, ZIP_FIELDS)) ?? fallbackZip,
      routeId,
      residential: asCount(pick(attributes, RES_FIELDS)),
      business: asCount(pick(attributes, BUS_FIELDS)),
      total: asCount(pick(attributes, TOT_FIELDS)),
      rings,
      paths,
      attributes,
    });
  }
  return routes;
}

/** The biggest ring by vertex count, which is the outer boundary in practice. */
export function outerRing(route: Pick<EddmRoute, "rings">): LngLatPair[] | null {
  if (route.rings.length === 0) return null;
  return [...route.rings].sort((a, b) => b.length - a.length)[0];
}

/** A palette wide enough that neighbouring routes read as different. */
const ROUTE_COLORS = ["#f59e0b", "#3b82f6", "#ec4899", "#10b981", "#8b5cf6", "#ef4444", "#14b8a6", "#f97316", "#84cc16", "#06b6d4"];

/** A route a team should not walk: drawn in one colour, whatever its number. */
export const HARD_ROUTE_COLOR = "#dc2626";

export function routeColor(index: number): string {
  return ROUTE_COLORS[((index % ROUTE_COLORS.length) + ROUTE_COLORS.length) % ROUTE_COLORS.length];
}

export interface EddmRouteProperties {
  id: string;
  zip: string;
  routeId: string;
  residential: number | null;
  business: number | null;
  total: number | null;
  color: string;
  /** From USPS's demographics, when present. */
  medianIncome: number | null;
  medianAge: number | null;
  householdSize: number | null;
  /** USPS's own flag: fewer than 200 deliveries, below the EDDM minimum. */
  under200: boolean;
  /** The post office the bundles for this route are taken to. */
  facility: string | null;
  walkability: "walkable" | "hard" | "unknown";
  walkabilityReason: string | null;
  houseCount: number | null;
  waveId: string | null;
}

export interface EddmRouteFeature {
  type: "Feature";
  geometry: { type: "Polygon"; coordinates: LngLatPair[][] };
  properties: EddmRouteProperties;
}

export interface EddmStreetFeature {
  type: "Feature";
  geometry: { type: "MultiLineString"; coordinates: LngLatPair[][] };
  properties: Pick<EddmRouteProperties, "id" | "routeId" | "color">;
}

function propertiesOf(r: EddmRoute & { id?: string }, index: number): EddmRouteProperties {
  const a = r.attributes;
  return {
    id: r.id ?? `${r.zip}-${r.routeId}`,
    zip: r.zip,
    routeId: r.routeId,
    residential: r.residential,
    business: r.business,
    total: r.total,
    color: r.walkability === "hard" ? HARD_ROUTE_COLOR : routeColor(index),
    medianIncome: asCount(pick(a, ["MED_INCOME", "AVG_INCOME", "MEDIAN_INCOME"])),
    medianAge: asCount(pick(a, ["MED_AGE", "AVG_AGE", "MEDIAN_AGE"])),
    householdSize: (() => {
      const v = pick(a, ["AVG_HH_SIZ", "AVG_HH_SIZE", "HH_SIZE"]);
      const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
      return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
    })(),
    under200: String(pick(a, ["LT_200_IND"]) ?? "").toUpperCase() === "Y",
    facility: asText(pick(a, ["FAC_NAME", "FACILITY_NAME", "FACILITY"])),
    walkability: r.walkability ?? "unknown",
    walkabilityReason: r.walkabilityReason ?? null,
    houseCount: r.houseCount ?? null,
    waveId: r.waveId ?? null,
  };
}

/** Routes as the map draws them: one boundary polygon each, outer ring first. */
export function routesToFeatures(routes: (EddmRoute & { id?: string })[]): EddmRouteFeature[] {
  return routes
    .filter((r) => r.rings.length > 0)
    .map((r, index) => {
      const outer = outerRing(r)!;
      return {
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [outer] },
        properties: propertiesOf(r, index),
      };
    });
}

/** The streets of each route, coloured to match its boundary. */
export function routesToStreetFeatures(routes: (EddmRoute & { id?: string })[]): EddmStreetFeature[] {
  return routes
    .filter((r) => r.paths.length > 0)
    .map((r, index) => ({
      type: "Feature",
      geometry: { type: "MultiLineString", coordinates: r.paths },
      properties: { id: r.id ?? `${r.zip}-${r.routeId}`, routeId: r.routeId, color: r.walkability === "hard" ? HARD_ROUTE_COLOR : routeColor(index) },
    }));
}
