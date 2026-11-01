import { publicEnv } from "@/lib/public-env";
import { log } from "@/lib/log";
import { countyKey, newestYearInName, parseFlightYears, pickNewest } from "@/lib/md-imagery";
import { mapboxStaticUrl, parseStaticPath, pinsSvg, planTiles, type StaticRequest, type TilePlan } from "@/lib/static-imagery";

/**
 * The newest aerial photos there are for a place, and pictures drawn from
 * them. See static-imagery.ts for why.
 *
 * Anywhere in Maryland, the newest of:
 *   - Harford County's own flights (one tiled service per year, 3 inches),
 *   - the state's 3-inch collection (much of the state, flown 2020 to 2025),
 *   - the state's 6-inch collection (all of it, newest regional flights),
 * newest first and the sharpest of those, each found by name so a new
 * flight is used the day it is published. The year over an address comes
 * from the county it is in (the Census's lookup) and what each service says
 * it covers. Outside Maryland, or if a server is down, Mapbox as before.
 */

export interface ImagerySource {
  id: string;
  /** For the credits, and the client's "photo from" line: e.g. "Maryland aerial photo, 2025". */
  name: string;
  year: number;
  /** Inches on the ground a pixel. */
  inches: number;
  /** "tiles": a standard z/x/y tile scheme. "export": an ArcGIS map service drawn to any box asked for. */
  kind: "tiles" | "export";
  /** For an interactive map: {z}/{x}/{y}, or {bbox-epsg-3857} for an export source. */
  tileUrl: string;
  /** The most detailed tile level worth asking for (256-pixel scheme). */
  maxLevel: number;
  /** West, south, east, north. */
  bounds: [number, number, number, number];
  /** An export source's export endpoint. */
  exportUrl?: string;
}

const HARFORD_ORTHOPHOTOS = "https://hcggis.harfordcountymd.gov/arcgis/rest/services/Orthophotos";
const MD_IMAGERY = "https://mdgeodata.md.gov/imagery/rest/services";
const COUNTY_LOOKUP = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1/query";
const MARYLAND_FIPS = "24";
const DAY = 86_400_000;
const LOOKUP_MS = 5_000;
const TILE_MS = 8_000;
/** Above this many tiles a picture is Mapbox's: a very large one costs the county too much. */
const MAX_TILES = 400;
/** The state's server draws at most this many pixels a side. */
const MAX_EXPORT = 4096;

async function getJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(LOOKUP_MS), next: { revalidate: 43_200 } });
    return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Web Mercator metres to degrees. */
function toLngLat(x: number, y: number): [number, number] {
  return [(x / 20037508.34) * 180, (Math.atan(Math.exp((y / 20037508.34) * Math.PI)) * 360) / Math.PI - 90];
}

function boundsOf(extent: unknown): [number, number, number, number] | null {
  const e = extent as { xmin: number; ymin: number; xmax: number; ymax: number } | undefined;
  if (!e || ![e.xmin, e.ymin, e.xmax, e.ymax].every(Number.isFinite)) return null;
  const [west, south] = toLngLat(e.xmin, e.ymin);
  const [east, north] = toLngLat(e.xmax, e.ymax);
  return [west, south, east, north];
}

/** The level whose pixels are the photo's own (256-pixel scheme). */
const nativeLevel = (metresPerPixel: number) => Math.round(Math.log2(156_543.033_92 / metresPerPixel));

/** A Harford flight, a statewide collection: the source, and which county gets which year. */
interface Collection {
  source: Omit<ImagerySource, "year" | "name">;
  label: string;
  /** Year by countyKey. For a county-only collection, its one county. */
  years: Map<string, number>;
  /** Whether a point needs checking for pixels: a collection with gaps (the 3-inch one) does. */
  patchy: boolean;
}

async function harfordCollection(): Promise<Collection | null> {
  const folder = await getJson(`${HARFORD_ORTHOPHOTOS}?f=json`);
  const names = ((folder?.services as { name: string; type: string }[] | undefined) ?? [])
    .filter((s) => s.type === "ImageServer")
    .map((s) => ({ name: s.name, year: newestYearInName(s.name) ?? 0 }))
    .filter((s) => s.year > 2000)
    .sort((a, b) => b.year - a.year);
  for (const candidate of names.slice(0, 3)) {
    const service = `https://hcggis.harfordcountymd.gov/arcgis/rest/services/${candidate.name}/ImageServer`;
    const info = await getJson(`${service}?f=json`);
    const bounds = boundsOf(info?.extent);
    const pixel = Number(info?.pixelSizeX);
    if (!bounds || !(pixel > 0) || !info?.singleFusedMapCache) continue;
    return {
      source: { id: `harford-${candidate.year}`, inches: Math.round(pixel * 39.37), kind: "tiles", tileUrl: `${service}/tile/{z}/{y}/{x}`, maxLevel: nativeLevel(pixel), bounds },
      label: "Harford County aerial photo",
      years: new Map([[countyKey("Harford"), candidate.year]]),
      patchy: false,
    };
  }
  return null;
}

/** One of the state's collections: the newest service in a folder whose name matches. */
async function stateCollection(folder: string, matches: RegExp, inches: number, patchy: boolean): Promise<Collection | null> {
  const list = await getJson(`${MD_IMAGERY}/${folder}?f=json`);
  const services = ((list?.services as { name: string; type: string }[] | undefined) ?? [])
    .filter((s) => s.type === "MapServer" && matches.test(s.name))
    // Newest by the years in the name; a name with none (the "current" alias) last.
    .sort((a, b) => (newestYearInName(b.name) ?? 0) - (newestYearInName(a.name) ?? 0));
  for (const service of services.slice(0, 2)) {
    const url = `${MD_IMAGERY}/${service.name}/MapServer`;
    const info = await getJson(`${url}?f=json`);
    const bounds = boundsOf(info?.fullExtent);
    const years = parseFlightYears(String(info?.serviceDescription ?? info?.description ?? ""));
    if (!bounds || years.size === 0) continue;
    const exportUrl = `${url}/export`;
    return {
      source: {
        id: `md-${inches}in`,
        inches,
        kind: "export",
        exportUrl,
        tileUrl: `${exportUrl}?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=jpg&f=image`,
        maxLevel: nativeLevel((inches / 39.37) * 1),
        bounds,
      },
      label: "Maryland aerial photo",
      years,
      patchy,
    };
  }
  return null;
}

let cached: { until: number; collections: Collection[] } | null = null;

async function collections(): Promise<Collection[]> {
  if (cached && cached.until > Date.now()) return cached.collections;
  const found = (
    await Promise.all([
      harfordCollection().catch(() => null),
      stateCollection("ThreeInch", /MD_ThreeInchImagery$/, 3, true).catch(() => null),
      stateCollection("SixInch", /SixInchImagery\d{4}(_\d{4})*$/, 6, false).catch(() => null),
    ])
  ).filter((c): c is Collection => c !== null);
  // A failed lookup is tried again in ten minutes, not tomorrow.
  cached = { until: Date.now() + (found.length > 0 ? DAY / 2 : DAY / 144), collections: found };
  return found;
}

/** A small cache by place, rounded to about a hundred metres. */
function placeCache<T>(limit = 2000) {
  const map = new Map<string, T>();
  return {
    get: (lng: number, lat: number) => map.get(`${lng.toFixed(3)},${lat.toFixed(3)}`),
    set: (lng: number, lat: number, value: T) => {
      if (map.size >= limit) map.delete(map.keys().next().value!);
      map.set(`${lng.toFixed(3)},${lat.toFixed(3)}`, value);
    },
  };
}

const counties = placeCache<{ state: string; county: string } | null>();

/** The county a point is in, from the Census. Null when it can't be told. */
async function countyAt(lng: number, lat: number): Promise<{ state: string; county: string } | null> {
  const known = counties.get(lng, lat);
  if (known !== undefined) return known;
  const url =
    `${COUNTY_LOOKUP}?geometry=${lng},${lat}&geometryType=esriGeometryPoint&inSR=4326` +
    `&spatialRel=esriSpatialRelIntersects&outFields=NAME,STATE&returnGeometry=false&f=json`;
  const json = await getJson(url);
  const attrs = (json?.features as { attributes: { NAME: string; STATE: string } }[] | undefined)?.[0]?.attributes;
  const found = attrs ? { state: String(attrs.STATE), county: attrs.NAME } : null;
  // An answer is kept; a failed lookup isn't, so it is asked again next time.
  if (json) counties.set(lng, lat, found);
  return found;
}

const covered = placeCache<boolean>();

/** Whether an export source has pixels at a point: the 3-inch collection has gaps between its flights. */
async function hasPixelsAt(source: Collection["source"], lng: number, lat: number): Promise<boolean> {
  const known = covered.get(lng, lat + source.inches * 1000);
  if (known !== undefined) return known;
  try {
    const x = (lng * 20037508.34) / 180;
    const y = (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) * 20037508.34) / Math.PI;
    const res = await fetch(
      `${source.exportUrl}?bbox=${x - 10},${y - 10},${x + 10},${y + 10}&bboxSR=3857&imageSR=3857&size=16,16&format=png32&transparent=true&f=image`,
      { signal: AbortSignal.timeout(LOOKUP_MS) }
    );
    if (!res.ok) return false;
    const sharp = (await import("sharp")).default;
    const { data, info } = await sharp(Buffer.from(await res.arrayBuffer())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let opaque = 0;
    for (let i = info.channels - 1; i < data.length; i += info.channels) if (data[i] > 0) opaque++;
    const answer = opaque > (info.width * info.height) / 2;
    covered.set(lng, lat + source.inches * 1000, answer);
    return answer;
  } catch {
    return false;
  }
}

/** The newest aerial covering a point, or null where only Mapbox does. */
export async function imageryAt(lng: number, lat: number): Promise<ImagerySource | null> {
  const all = await collections();
  const inBounds = all.filter(({ source: { bounds: [w, s, e, n] } }) => lng >= w && lng <= e && lat >= s && lat <= n);
  if (inBounds.length === 0) return null;
  const place = await countyAt(lng, lat);
  if (!place || place.state !== MARYLAND_FIPS) return null;
  const key = countyKey(place.county);

  const candidates = (
    await Promise.all(
      inBounds.map(async (c) => {
        const year = c.years.get(key);
        if (!year) return null;
        if (c.patchy && !(await hasPixelsAt(c.source, lng, lat))) return null;
        return { ...c.source, year, name: `${c.label}, ${year}` } satisfies ImagerySource;
      })
    )
  ).filter((c): c is ImagerySource => c !== null);
  return pickNewest(candidates);
}

async function fetchImage(url: string, ms = TILE_MS): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(ms), next: { revalidate: 30 * 86_400 } });
    if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export interface DrawnPicture {
  body: Buffer;
  contentType: string;
  /** Which source drew it: an ImagerySource id, or "mapbox". */
  source: string;
  credit: string;
}

async function fromMapbox(path: string): Promise<DrawnPicture> {
  if (!publicEnv.mapboxToken) throw new Error("No Mapbox token for the fallback picture.");
  const res = await fetch(mapboxStaticUrl(path, publicEnv.mapboxToken), { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Mapbox answered ${res.status}.`);
  return {
    body: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get("content-type") ?? "image/jpeg",
    source: "mapbox",
    credit: "© Mapbox © OpenStreetMap © Maxar",
  };
}

/** The area a picture needs, from tiles: every one has to arrive, or null. */
async function regionFromTiles(source: ImagerySource, plan: TilePlan): Promise<Buffer | null> {
  if (plan.tiles.length === 0 || plan.tiles.length > MAX_TILES) return null;
  // A few at a time: it is the county's server.
  const buffers: (Buffer | null)[] = new Array(plan.tiles.length).fill(null);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(12, plan.tiles.length) }, async () => {
      while (next < plan.tiles.length) {
        const i = next++;
        const t = plan.tiles[i];
        buffers[i] = await fetchImage(source.tileUrl.replace("{z}", String(plan.level)).replace("{y}", String(t.y)).replace("{x}", String(t.x)));
      }
    })
  );
  if (buffers.some((b) => b === null)) {
    log.warn("imagery.tiles_missing", { source: source.id, missing: buffers.filter((b) => b === null).length, of: buffers.length });
    return null;
  }
  const sharp = (await import("sharp")).default;
  // Tiles land on a grid that starts at or before the area wanted; the area is cut from it.
  const shiftX = -Math.min(...plan.tiles.map((t) => t.dx));
  const shiftY = -Math.min(...plan.tiles.map((t) => t.dy));
  const gridWidth = Math.max(...plan.tiles.map((t) => t.dx)) + 256 + shiftX;
  const gridHeight = Math.max(...plan.tiles.map((t) => t.dy)) + 256 + shiftY;
  const grid = await sharp({ create: { width: gridWidth, height: gridHeight, channels: 3, background: "#000" } })
    .composite(plan.tiles.map((t, i) => ({ input: buffers[i]!, left: t.dx + shiftX, top: t.dy + shiftY })))
    .png()
    .toBuffer();
  return sharp(grid).extract({ left: shiftX, top: shiftY, width: plan.regionWidth, height: plan.regionHeight }).toBuffer();
}

/** The area a picture needs, drawn by an export source in one request. */
async function regionFromExport(source: ImagerySource, plan: TilePlan): Promise<Buffer | null> {
  if (!source.exportUrl || plan.regionWidth > MAX_EXPORT || plan.regionHeight > MAX_EXPORT) return null;
  // World pixels at the plan's level, to Web Mercator metres.
  const metres = (2 * 20037508.34) / (256 * 2 ** plan.level);
  const xmin = plan.left * metres - 20037508.34;
  const ymax = 20037508.34 - plan.top * metres;
  const xmax = xmin + plan.regionWidth * metres;
  const ymin = ymax - plan.regionHeight * metres;
  return fetchImage(
    `${source.exportUrl}?bbox=${xmin},${ymin},${xmax},${ymax}&bboxSR=3857&imageSR=3857&size=${plan.regionWidth},${plan.regionHeight}&format=jpg&f=image`,
    20_000
  );
}

/** Turned, cut to size and pinned: the same finish whichever source drew the area. */
async function finish(region: Buffer, req: StaticRequest, plan: TilePlan): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  let turned = region;
  if (req.bearing !== 0) {
    // Turned anticlockwise by the bearing, so what lies that way points up.
    turned = await sharp(region).rotate(-req.bearing, { background: "#000" }).toBuffer();
  }
  const meta = await sharp(turned).metadata();
  const keepWidth = Math.round(plan.outWidth * plan.ratio);
  const keepHeight = Math.round(plan.outHeight * plan.ratio);
  const picture = sharp(turned)
    .extract({
      left: Math.max(0, Math.round(((meta.width ?? keepWidth) - keepWidth) / 2)),
      top: Math.max(0, Math.round(((meta.height ?? keepHeight) - keepHeight) / 2)),
      width: Math.min(keepWidth, meta.width ?? keepWidth),
      height: Math.min(keepHeight, meta.height ?? keepHeight),
    })
    .resize(plan.outWidth, plan.outHeight, { fit: "fill" });
  return (req.pins.length > 0 ? sharp(await picture.toBuffer()).composite([{ input: Buffer.from(pinsSvg(req, plan)) }]) : picture)
    .jpeg({ quality: 85 })
    .toBuffer();
}

/**
 * A picture asked for the way a Mapbox static image is ("pins/lng,lat,zoom,
 * bearing/WxH@2x"), drawn from the newest aerial covering it. All of it has
 * to come from that one source: a picture half from one year and half from
 * another would show a yard that never existed, so any gap and it is
 * Mapbox's instead.
 */
export async function drawStaticPicture(path: string): Promise<DrawnPicture> {
  const req = parseStaticPath(path);
  const source = req ? await imageryAt(req.lng, req.lat).catch(() => null) : null;
  if (!req || !source) return fromMapbox(path);

  const plan = planTiles(req, source.maxLevel);
  try {
    const region = source.kind === "tiles" ? await regionFromTiles(source, plan) : await regionFromExport(source, plan);
    if (!region) return fromMapbox(path);
    return { body: await finish(region, req, plan), contentType: "image/jpeg", source: source.id, credit: source.name };
  } catch (err) {
    log.warn("imagery.draw_failed", { source: source.id, error: err instanceof Error ? err.message : String(err) });
    return fromMapbox(path);
  }
}
