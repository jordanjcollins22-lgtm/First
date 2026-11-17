/**
 * Satellite pictures from the newest aerial photos there are for a place,
 * asked for exactly the way a Mapbox static image is.
 *
 * Mapbox's satellite photos are often years old, and a bed that was dug,
 * mulched or ripped out since is priced from a picture that no longer
 * matches the yard. A county's own aerial flights are usually far newer and
 * sharper (Harford County flies every year or two, at 3 inches a pixel). So
 * every satellite picture in the app is asked for here, in the same
 * "pins / lng,lat,zoom,bearing / WxH@2x" form a Mapbox static URL takes, and
 * drawn from the newest source covering the spot, with Mapbox as the
 * fallback. Same form means same geometry: a picture at zoom 19 covers the
 * same ground whichever source drew it, so anything measured off it (the
 * site map's scale, the AI's feet per pixel) stays right.
 *
 * Pure: parsing the request, planning which tiles cover it, placing pins.
 */

export interface StaticPin {
  size: "s" | "l";
  /** A number or a letter printed on the pin, Mapbox's "pin-l-3". */
  label: string | null;
  /** Hex, without the #. */
  color: string;
  lng: number;
  lat: number;
}

export interface StaticRequest {
  pins: StaticPin[];
  lng: number;
  lat: number;
  /** Mapbox's zoom: 512-pixel tiles, so a level higher than a 256-pixel tile scheme's. */
  zoom: number;
  bearing: number;
  /** In logical pixels; the picture is width × scale wide. */
  width: number;
  height: number;
  scale: 1 | 2;
}

/** Mapbox's own limit, and ours: bigger pictures cost the county's server too much. */
export const MAX_SIDE = 1280;

const PIN = /^pin-(s|l)(?:-([a-z0-9]{1,2}))?\+([0-9a-f]{3}|[0-9a-f]{6})\((-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\)$/i;

/**
 * "pin-s+2f6d3c(-76.3,39.5)/-76.3,39.5,19,0/480x320@2x" into its parts, or
 * null for anything else (a style, "auto" framing, a path overlay), which
 * then goes to Mapbox as it was.
 */
export function parseStaticPath(path: string): StaticRequest | null {
  const parts = path.split("?")[0].split("/").filter(Boolean);
  if (parts.length !== 2 && parts.length !== 3) return null;
  const [overlay, position, size] = parts.length === 3 ? parts : [null, parts[0], parts[1]];

  const pins: StaticPin[] = [];
  if (overlay) {
    // Pins are comma-separated, and so are the coordinates inside them.
    for (const raw of overlay.match(/pin-[^()]+\([^)]*\)/gi) ?? []) {
      const m = PIN.exec(raw);
      if (!m) return null;
      pins.push({ size: m[1].toLowerCase() as "s" | "l", label: m[2] ?? null, color: m[3].toLowerCase(), lng: Number(m[4]), lat: Number(m[5]) });
    }
    if (pins.length === 0 || pins.length > 60) return null;
  }

  const nums = position.split(",").map(Number);
  if (nums.length < 3 || nums.length > 5 || nums.some((n) => !Number.isFinite(n))) return null;
  const [lng, lat, zoom, bearing = 0] = nums;
  if (Math.abs(lng) > 180 || Math.abs(lat) > 85 || zoom < 0 || zoom > 22) return null;

  const sz = /^(\d{1,4})x(\d{1,4})(@2x)?$/.exec(size);
  if (!sz) return null;
  const width = Number(sz[1]);
  const height = Number(sz[2]);
  if (width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE) return null;

  return { pins, lng, lat, zoom, bearing: ((bearing % 360) + 360) % 360, width, height, scale: sz[3] ? 2 : 1 };
}

/** Where a point is on a 256-pixel tile scheme's world at `level`, in pixels. */
export function worldPixel(lng: number, lat: number, level: number): [number, number] {
  const size = 256 * 2 ** level;
  const sin = Math.sin((lat * Math.PI) / 180);
  return [((lng + 180) / 360) * size, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size];
}

export interface TilePlan {
  /** The tile level fetched. */
  level: number;
  /** Fetched pixels per output pixel: above 1 is shrunk to fit, below 1 is enlarged past the source's detail. */
  ratio: number;
  /** The fetched area's top-left, in world pixels at `level`. */
  left: number;
  top: number;
  /** The fetched area's size, in pixels at `level`. */
  regionWidth: number;
  regionHeight: number;
  tiles: { x: number; y: number; dx: number; dy: number }[];
  /** The picture's size, in real pixels. */
  outWidth: number;
  outHeight: number;
}

/**
 * The tiles that cover a picture, from a 256-pixel tile source whose most
 * detailed level is `maxLevel`. A turned picture fetches the square its
 * corners sweep, so there is photo under them once it is turned.
 */
export function planTiles(req: StaticRequest, maxLevel: number): TilePlan {
  // Mapbox's zoom z at scale s draws 512·s·2^z pixels round the world; a
  // 256-pixel scheme matches that at level z + log2(2s).
  const ideal = req.zoom + Math.log2(2 * req.scale);
  const level = Math.max(0, Math.min(maxLevel, Math.ceil(ideal - 1e-9)));
  const ratio = 2 ** (level - ideal);
  const outWidth = req.width * req.scale;
  const outHeight = req.height * req.scale;
  const turned = req.bearing % 360 !== 0;
  const span = Math.hypot(outWidth, outHeight);
  const regionWidth = Math.ceil((turned ? span : outWidth) * ratio) + 2;
  const regionHeight = Math.ceil((turned ? span : outHeight) * ratio) + 2;
  const [cx, cy] = worldPixel(req.lng, req.lat, level);
  const left = Math.floor(cx - regionWidth / 2);
  const top = Math.floor(cy - regionHeight / 2);

  const tiles: TilePlan["tiles"] = [];
  const count = 2 ** level;
  for (let ty = Math.floor(top / 256); ty <= Math.floor((top + regionHeight - 1) / 256); ty++) {
    if (ty < 0 || ty >= count) continue;
    for (let tx = Math.floor(left / 256); tx <= Math.floor((left + regionWidth - 1) / 256); tx++) {
      tiles.push({ x: ((tx % count) + count) % count, y: ty, dx: tx * 256 - left, dy: ty * 256 - top });
    }
  }
  return { level, ratio, left, top, regionWidth, regionHeight, tiles, outWidth, outHeight };
}

/** Where a pin lands on the finished picture, in its pixels: turned with the map. */
export function pinPosition(req: StaticRequest, plan: TilePlan, pin: { lng: number; lat: number }): [number, number] {
  const [cx, cy] = worldPixel(req.lng, req.lat, plan.level);
  const [px, py] = worldPixel(pin.lng, pin.lat, plan.level);
  const dx = (px - cx) / plan.ratio;
  const dy = (py - cy) / plan.ratio;
  const b = (req.bearing * Math.PI) / 180;
  // The map turns anticlockwise by the bearing, so what is at the bearing points up.
  const x = dx * Math.cos(b) + dy * Math.sin(b);
  const y = -dx * Math.sin(b) + dy * Math.cos(b);
  return [plan.outWidth / 2 + x, plan.outHeight / 2 + y];
}

/** The pins as an SVG laid over the picture, small dots or numbered discs like Mapbox's. */
export function pinsSvg(req: StaticRequest, plan: TilePlan): string {
  const s = req.scale;
  const marks = req.pins.map((pin) => {
    const [x, y] = pinPosition(req, plan, pin);
    const r = (pin.size === "l" ? 13 : 7) * s;
    const fill = `#${pin.color}`;
    const label = pin.label
      ? `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" dy="0.35em" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${(pin.size === "l" ? 14 : 9) * s}" fill="#fff">${pin.label.replace(/[^a-z0-9]/gi, "")}</text>`
      : "";
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${fill}" stroke="#fff" stroke-width="${2 * s}"/>${label}`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${plan.outWidth}" height="${plan.outHeight}">${marks.join("")}</svg>`;
}

/** The same picture from Mapbox: the fallback, and anything we don't draw ourselves. */
export function mapboxStaticUrl(path: string, token: string): string {
  const clean = path.split("?")[0].replace(/^\/+/, "");
  return `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${clean}?attribution=false&logo=false&access_token=${encodeURIComponent(token)}`;
}

/** Where the app asks for a picture: our route, in Mapbox's form. */
export function staticImageryPath(path: string): string {
  return `/api/imagery/static/${path.replace(/^\/+/, "")}`;
}
