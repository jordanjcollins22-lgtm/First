import { publicEnv } from "@/lib/public-env";
import { log } from "@/lib/log";
import { mapboxStaticUrl, parseStaticPath, pinsSvg, planTiles } from "@/lib/static-imagery";

/**
 * The newest aerial photos there are for a place, and pictures drawn from
 * them. See static-imagery.ts for why.
 *
 * Today that is Harford County's own flights: one tiled image service per
 * year in its Orthophotos folder, the newest picked by name, so a new flight
 * is used the day the county publishes it with nothing to change here.
 * Anywhere they don't cover, or if the county's server is down, Mapbox draws
 * the picture as before.
 */

export interface ImagerySource {
  id: string;
  /** For the credits under a picture, e.g. "Harford County aerial photo, 2025". */
  name: string;
  year: number;
  /** A tile URL with {z}, {x} and {y}, for an interactive map. */
  tileUrl: string;
  /** Its most detailed tile level (256-pixel scheme). */
  maxLevel: number;
  /** West, south, east, north. */
  bounds: [number, number, number, number];
}

const HARFORD_ORTHOPHOTOS = "https://hcggis.harfordcountymd.gov/arcgis/rest/services/Orthophotos";
const DAY = 86_400_000;
const LOOKUP_MS = 5_000;
const TILE_MS = 8_000;
/** Above this many tiles a picture is Mapbox's: a very large one costs the county too much. */
const MAX_TILES = 400;

let cached: { until: number; sources: ImagerySource[] } | null = null;

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

/** Harford County's newest flight: the year services in its Orthophotos folder, newest first. */
async function harfordSources(): Promise<ImagerySource[]> {
  const folder = await getJson(`${HARFORD_ORTHOPHOTOS}?f=json`);
  const names = ((folder?.services as { name: string; type: string }[] | undefined) ?? [])
    .filter((s) => s.type === "ImageServer")
    .map((s) => ({ name: s.name, year: Number(/WM(\d{4})/.exec(s.name)?.[1]) }))
    .filter((s) => s.year > 2000)
    .sort((a, b) => b.year - a.year);

  for (const candidate of names.slice(0, 3)) {
    const service = `https://hcggis.harfordcountymd.gov/arcgis/rest/services/${candidate.name}/ImageServer`;
    const info = await getJson(`${service}?f=json`);
    const extent = info?.extent as { xmin: number; ymin: number; xmax: number; ymax: number } | undefined;
    const pixel = Number(info?.pixelSizeX);
    if (!extent || !(pixel > 0) || !info?.singleFusedMapCache) continue;
    const [west, south] = toLngLat(extent.xmin, extent.ymin);
    const [east, north] = toLngLat(extent.xmax, extent.ymax);
    return [
      {
        id: `harford-${candidate.year}`,
        name: `Harford County aerial photo, ${candidate.year}`,
        year: candidate.year,
        tileUrl: `${service}/tile/{z}/{y}/{x}`,
        // The level whose pixels are the photo's own: finer levels aren't published.
        maxLevel: Math.round(Math.log2(156_543.033_92 / pixel)),
        bounds: [west, south, east, north],
      },
    ];
  }
  return [];
}

async function sources(): Promise<ImagerySource[]> {
  if (cached && cached.until > Date.now()) return cached.sources;
  const found = await harfordSources().catch(() => []);
  // A failed lookup is tried again in ten minutes, not tomorrow.
  cached = { until: Date.now() + (found.length > 0 ? DAY / 2 : DAY / 144), sources: found };
  return found;
}

/** The newest aerial covering a point, or null where only Mapbox does. */
export async function imageryAt(lng: number, lat: number): Promise<ImagerySource | null> {
  return (
    (await sources()).find(({ bounds: [w, s, e, n] }) => lng >= w && lng <= e && lat >= s && lat <= n) ?? null
  );
}

async function fetchTile(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TILE_MS), next: { revalidate: 30 * 86_400 } });
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

/**
 * A picture asked for the way a Mapbox static image is ("pins/lng,lat,zoom,
 * bearing/WxH@2x"), drawn from the newest aerial covering it. Every tile has
 * to arrive: a picture half from one year and half from another would show
 * a yard that never existed, so any gap and it is Mapbox's instead.
 */
export async function drawStaticPicture(path: string): Promise<DrawnPicture> {
  const req = parseStaticPath(path);
  const source = req ? await imageryAt(req.lng, req.lat) : null;
  if (!req || !source) return fromMapbox(path);

  const plan = planTiles(req, source.maxLevel);
  if (plan.tiles.length === 0 || plan.tiles.length > MAX_TILES) return fromMapbox(path);

  // A few at a time: it is the county's server.
  const buffers: (Buffer | null)[] = new Array(plan.tiles.length).fill(null);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(12, plan.tiles.length) }, async () => {
      while (next < plan.tiles.length) {
        const i = next++;
        const t = plan.tiles[i];
        buffers[i] = await fetchTile(source.tileUrl.replace("{z}", String(plan.level)).replace("{y}", String(t.y)).replace("{x}", String(t.x)));
      }
    })
  );
  if (buffers.some((b) => b === null)) {
    log.warn("imagery.tiles_missing", { source: source.id, missing: buffers.filter((b) => b === null).length, of: buffers.length });
    return fromMapbox(path);
  }

  try {
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
    let region = await sharp(grid).extract({ left: shiftX, top: shiftY, width: plan.regionWidth, height: plan.regionHeight }).toBuffer();

    if (req.bearing !== 0) {
      // Turned anticlockwise by the bearing, so what lies that way points up.
      region = await sharp(region).rotate(-req.bearing, { background: "#000" }).toBuffer();
    }
    const meta = await sharp(region).metadata();
    const keepWidth = Math.round(plan.outWidth * plan.ratio);
    const keepHeight = Math.round(plan.outHeight * plan.ratio);
    const picture = sharp(region)
      .extract({
        left: Math.max(0, Math.round(((meta.width ?? keepWidth) - keepWidth) / 2)),
        top: Math.max(0, Math.round(((meta.height ?? keepHeight) - keepHeight) / 2)),
        width: Math.min(keepWidth, meta.width ?? keepWidth),
        height: Math.min(keepHeight, meta.height ?? keepHeight),
      })
      .resize(plan.outWidth, plan.outHeight, { fit: "fill" });
    const body = await (req.pins.length > 0
      ? sharp(await picture.toBuffer()).composite([{ input: Buffer.from(pinsSvg(req, plan)) }])
      : picture
    )
      .jpeg({ quality: 85 })
      .toBuffer();
    return { body, contentType: "image/jpeg", source: source.id, credit: source.name };
  } catch (err) {
    log.warn("imagery.draw_failed", { source: source.id, error: err instanceof Error ? err.message : String(err) });
    return fromMapbox(path);
  }
}
