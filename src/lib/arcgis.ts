/**
 * Reading an ArcGIS REST server, without trusting anything it has not said.
 *
 * Every county publishes the same shape of API and a different set of names
 * inside it. The three things this file knows how to do -- tell what kind of
 * endpoint a URL is, build a paged query against a layer, and turn a feature
 * back into an address and a point -- are pure, so the parts that decide what
 * a response means can be proved without a server, and the one part that
 * goes to the network (see gis-probe.ts) stays a dozen lines long.
 */

/** The three kinds of thing `?f=json` can describe. */
export type EndpointKind = "catalog" | "service" | "layer" | "unknown";

export interface ArcgisField {
  name: string;
  type: string;
  alias: string | null;
}

export interface ArcgisLayerSummary {
  id: number;
  name: string;
  /** Feature Layer, Group Layer, Raster Layer. Only the first can be queried. */
  type: string | null;
}

export interface EndpointDescription {
  kind: EndpointKind;
  /** A catalog lists services; a service lists layers; a layer lists fields. */
  services: string[];
  folders: string[];
  layers: ArcgisLayerSummary[];
  fields: ArcgisField[];
  layerName: string | null;
  /** How many features one query may return. The page size cannot exceed it. */
  maxRecordCount: number | null;
  /** Whether the layer will honour resultOffset. Without it there is no paging. */
  supportsPagination: boolean;
  geometryType: string | null;
  /** The server's own error, when it answered 200 with a failure inside. */
  error: string | null;
}

type Dict = Record<string, unknown>;

function isDict(value: unknown): value is Dict {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * What a `?f=json` body describes.
 *
 * Decided from what is present rather than from the URL, because the URL is
 * whatever somebody pasted and the body is what the server actually is.
 */
export function describeEndpoint(body: unknown): EndpointDescription {
  const empty: EndpointDescription = {
    kind: "unknown",
    services: [],
    folders: [],
    layers: [],
    fields: [],
    layerName: null,
    maxRecordCount: null,
    supportsPagination: false,
    geometryType: null,
    error: null,
  };
  if (!isDict(body)) return empty;

  // ArcGIS reports failures as a 200 with an error object. Treating that as
  // "no fields" would read as a layer with nothing in it.
  if (isDict(body.error)) {
    const message = str(body.error.message) ?? "The server returned an error.";
    const code = num(body.error.code);
    return { ...empty, error: code ? `${code}: ${message}` : message };
  }

  if (Array.isArray(body.fields)) {
    const fields = body.fields
      .filter(isDict)
      .map((f) => ({ name: str(f.name) ?? "", type: str(f.type) ?? "", alias: str(f.alias) }))
      .filter((f) => f.name);
    const advanced = isDict(body.advancedQueryCapabilities) ? body.advancedQueryCapabilities : {};
    return {
      ...empty,
      kind: "layer",
      fields,
      layerName: str(body.name),
      maxRecordCount: num(body.maxRecordCount),
      supportsPagination: advanced.supportsPagination === true,
      geometryType: str(body.geometryType),
    };
  }

  if (Array.isArray(body.layers)) {
    const layers = body.layers
      .filter(isDict)
      .map((l) => ({ id: num(l.id) ?? -1, name: str(l.name) ?? "", type: str(l.type) }))
      .filter((l) => l.id >= 0);
    return { ...empty, kind: "service", layers, layerName: str(body.mapName) ?? str(body.serviceDescription) };
  }

  if (Array.isArray(body.services) || Array.isArray(body.folders)) {
    const services = (Array.isArray(body.services) ? body.services : [])
      .filter(isDict)
      .map((s) => {
        const name = str(s.name) ?? "";
        const type = str(s.type);
        return type ? `${name}/${type}` : name;
      })
      .filter(Boolean);
    const folders = (Array.isArray(body.folders) ? body.folders : []).filter(
      (f): f is string => typeof f === "string"
    );
    return { ...empty, kind: "catalog", services, folders };
  }

  return empty;
}

/** `.../MapServer/3?f=json` with nothing else on it. The smallest possible request. */
export function metadataUrl(endpoint: string): string {
  const url = new URL(endpoint.trim().replace(/\/+$/, ""));
  url.search = "";
  url.searchParams.set("f", "json");
  return url.toString();
}

/** Trims a pasted URL down to the endpoint itself, dropping any `?f=json` on it. */
export function cleanEndpoint(endpoint: string): string {
  const url = new URL(endpoint.trim());
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

/** `.../MapServer` + `3` -> `.../MapServer/3`. */
export function layerUrl(serviceUrl: string, layerId: number): string {
  return `${cleanEndpoint(serviceUrl)}/${layerId}`;
}

/**
 * Which of a service's layers holds addresses.
 *
 * A name saying "address" beats one saying "parcel", because the county's
 * address layer is one point per address and its parcel layer is one polygon
 * per lot -- and a lot with four townhouses on it is four addresses. Group
 * and raster layers cannot be queried and are never chosen.
 */
export function pickAddressLayer(layers: ArcgisLayerSummary[]): ArcgisLayerSummary | null {
  const queryable = layers.filter((l) => !l.type || /feature/i.test(l.type));
  return (
    queryable.find((l) => /address/i.test(l.name)) ??
    queryable.find((l) => /parcel|cadastr/i.test(l.name)) ??
    null
  );
}

/** Doubles single quotes, which is the whole of SQL-literal escaping in a where clause. */
export function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * The where clause for one ZIP.
 *
 * Uses the layer's own ZIP field when it has one, and falls back to the
 * address text when it does not. The fallback is looser -- an address that
 * merely mentions 21014 -- but every parcel it lets through still has to pass
 * the address check before it becomes a house.
 */
export function zipWhere(zip: string, zipField: string | null, addressField: string): string {
  const clean = zip.replace(/\D/g, "").slice(0, 5);
  if (zipField) return `${zipField} LIKE ${sqlLiteral(`${clean}%`)}`;
  return `${addressField} LIKE ${sqlLiteral(`%${clean}%`)}`;
}

export interface QueryOptions {
  where: string;
  offset: number;
  pageSize: number;
  /** Which attributes to bring back. Everything, unless told otherwise. */
  outFields?: string[];
  returnGeometry?: boolean;
  /** Ask only how many rows match; no features come back. */
  countOnly?: boolean;
}

/**
 * A paged query against one layer.
 *
 * Always in WGS84 (outSR=4326) so a point comes back as the latitude and
 * longitude every other part of the app already speaks, whatever projection
 * the county stores its parcels in. Ordered by object id so two pages cannot
 * overlap or leave a gap between them: an unordered offset is undefined.
 */
export function queryUrl(layer: string, options: QueryOptions): string {
  const url = new URL(`${cleanEndpoint(layer)}/query`);
  url.searchParams.set("f", "json");
  url.searchParams.set("where", options.where || "1=1");
  if (options.countOnly) {
    url.searchParams.set("returnCountOnly", "true");
    return url.toString();
  }
  url.searchParams.set("outFields", options.outFields?.join(",") || "*");
  url.searchParams.set("returnGeometry", options.returnGeometry === false ? "false" : "true");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("orderByFields", "OBJECTID");
  url.searchParams.set("resultOffset", String(Math.max(0, Math.floor(options.offset))));
  url.searchParams.set("resultRecordCount", String(Math.max(1, Math.floor(options.pageSize))));
  return url.toString();
}

export interface ArcgisFeature {
  attributes: Record<string, unknown>;
  /** WGS84 centroid, when the feature had geometry we could read. */
  lat: number | null;
  lng: number | null;
}

export interface FeaturePage {
  features: ArcgisFeature[];
  /** The server hit its own page limit; there is more. */
  exceededTransferLimit: boolean;
  /** Field names as the server listed them on this page. */
  fields: string[];
  error: string | null;
}

/**
 * The centre of a feature's geometry.
 *
 * A point is itself. A polygon is the average of its outer ring's vertices,
 * which for a house lot is well inside the lot -- accurate enough to put a
 * marker on, and never used for identity. Anything else is no location.
 */
export function centroidOf(geometry: unknown): { lat: number; lng: number } | null {
  if (!isDict(geometry)) return null;

  const x = num(geometry.x);
  const y = num(geometry.y);
  if (x != null && y != null) return plausible(y, x);

  const rings = Array.isArray(geometry.rings) ? geometry.rings : null;
  const outer = rings && Array.isArray(rings[0]) ? rings[0] : null;
  if (!outer || outer.length === 0) return null;

  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const vertex of outer) {
    if (!Array.isArray(vertex)) continue;
    const vx = num(vertex[0]);
    const vy = num(vertex[1]);
    if (vx == null || vy == null) continue;
    sumX += vx;
    sumY += vy;
    count++;
  }
  if (count === 0) return null;
  return plausible(sumY / count, sumX / count);
}

/** Rejects a coordinate that is not a coordinate, which is what an unprojected value looks like. */
function plausible(lat: number, lng: number): { lat: number; lng: number } | null {
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** Reads a query response into features we can use, or the error it carried. */
export function parseFeaturePage(body: unknown): FeaturePage {
  const empty: FeaturePage = { features: [], exceededTransferLimit: false, fields: [], error: null };
  if (!isDict(body)) return { ...empty, error: "The server answered with something that was not a feature set." };

  if (isDict(body.error)) {
    return { ...empty, error: str(body.error.message) ?? "The server returned an error." };
  }

  const features = (Array.isArray(body.features) ? body.features : []).filter(isDict).map((f) => {
    const attributes = isDict(f.attributes) ? f.attributes : {};
    const centre = centroidOf(f.geometry);
    return { attributes, lat: centre?.lat ?? null, lng: centre?.lng ?? null };
  });

  const fields = (Array.isArray(body.fields) ? body.fields : [])
    .filter(isDict)
    .map((f) => str(f.name))
    .filter((name): name is string => Boolean(name));

  return {
    features,
    exceededTransferLimit: body.exceededTransferLimit === true,
    fields,
    error: null,
  };
}

/** Reads a `returnCountOnly` response. */
export function parseCount(body: unknown): number | null {
  if (!isDict(body)) return null;
  return num(body.count);
}
