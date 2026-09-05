/**
 * Reading USPS's EDDM map service.
 *
 * Every Door Direct Mail is sold by carrier route, and USPS draws the routes
 * on its own map from an ArcGIS server at gis.usps.com. There is no documented
 * API; what there is, is the request that map makes -- a geoprocessing task
 * that takes a ZIP and answers with the routes in it as a feature set. So
 * nothing here assumes a field name: the attributes are searched for the
 * route id and the counts under the several names USPS has used, and the
 * geometry is accepted in either of the two projections it has come back in.
 *
 * Kept pure. What USPS answers is written to the database with the request
 * that produced it, so when the service changes shape the change is visible
 * there rather than as a map with no routes on it.
 */

export interface EddmRoute {
  zip: string;
  routeId: string;
  residential: number | null;
  business: number | null;
  total: number | null;
  /** Rings of [lng, lat], WGS84. The first is normally the outer boundary. */
  rings: [number, number][][];
  attributes: Record<string, unknown>;
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
export function mercatorToLngLat(x: number, y: number): [number, number] {
  const R = 6378137;
  const lng = (x / R) * (180 / Math.PI);
  const lat = (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI);
  return [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6];
}

/** Whether a coordinate pair can only be metres, not degrees. */
function looksProjected(x: number, y: number): boolean {
  return Math.abs(x) > 180 || Math.abs(y) > 90;
}

function ringsOf(geometry: unknown): [number, number][][] {
  if (!isDict(geometry) || !Array.isArray(geometry.rings)) return [];
  const rings: [number, number][][] = [];
  for (const ring of geometry.rings) {
    if (!Array.isArray(ring)) continue;
    const points: [number, number][] = [];
    for (const vertex of ring) {
      if (!Array.isArray(vertex)) continue;
      const x = Number(vertex[0]);
      const y = Number(vertex[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      points.push(looksProjected(x, y) ? mercatorToLngLat(x, y) : [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6]);
    }
    if (points.length >= 4) rings.push(points);
  }
  return rings;
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

/** Every route in a response, with what we could read of it. */
export function parseEddmRoutes(body: unknown, fallbackZip: string): EddmRoute[] {
  const routes: EddmRoute[] = [];
  for (const feature of featuresIn(body)) {
    const attributes = isDict(feature.attributes) ? feature.attributes : {};
    const routeId = asText(pick(attributes, ROUTE_ID_FIELDS));
    const rings = ringsOf(feature.geometry);
    if (!routeId || rings.length === 0) continue;
    routes.push({
      zip: asText(pick(attributes, ZIP_FIELDS)) ?? fallbackZip,
      routeId,
      residential: asCount(pick(attributes, RES_FIELDS)),
      business: asCount(pick(attributes, BUS_FIELDS)),
      total: asCount(pick(attributes, TOT_FIELDS)),
      rings,
      attributes,
    });
  }
  return routes;
}

/** The biggest ring by vertex count, which is the outer boundary in practice. */
export function outerRing(route: Pick<EddmRoute, "rings">): [number, number][] | null {
  if (route.rings.length === 0) return null;
  return [...route.rings].sort((a, b) => b.length - a.length)[0];
}

export interface EddmRouteFeature {
  type: "Feature";
  geometry: { type: "Polygon"; coordinates: [number, number][][] };
  properties: {
    id: string;
    zip: string;
    routeId: string;
    residential: number | null;
    business: number | null;
    total: number | null;
  };
}

/** Routes as the map draws them: one polygon each, outer ring first. */
export function routesToFeatures(
  routes: (EddmRoute & { id?: string })[]
): EddmRouteFeature[] {
  return routes
    .filter((r) => r.rings.length > 0)
    .map((r) => {
      const outer = outerRing(r)!;
      const holes = r.rings.filter((ring) => ring !== outer);
      return {
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [outer, ...holes] },
        properties: {
          id: r.id ?? `${r.zip}-${r.routeId}`,
          zip: r.zip,
          routeId: r.routeId,
          residential: r.residential,
          business: r.business,
          total: r.total,
        },
      };
    });
}
