/**
 * The county's roads from OpenStreetMap, for the walks to follow.
 *
 * USPS draws only the streets it delivers on, so a road with no doors is
 * missing from its lines and two halves of a neighbourhood either side of
 * it are islands; the walk between them went as the crow flies, through
 * the woods. OpenStreetMap has every road, lane, path and footway. Read
 * once for the county in tiles from the Overpass API, kept as straight
 * segments in the same metre frame as the USPS lines, and used by the
 * walk wherever it has them. Pure: tiles, the query, and the parse.
 */

import type { JobRow } from "@/lib/gis-import-run";

export const OSM_KIND = "osm_roads";

/** Harford County, with a margin. Bad geocodes far outside it are not roads we need. */
export const HARFORD_BBOX = { south: 39.36, west: -76.58, north: 39.74, east: -76.06 };

export interface Tile {
  key: string;
  south: number;
  west: number;
  north: number;
  east: number;
}

/** The county cut into tiles small enough for Overpass to answer in one go. */
export function tilesFor(bbox: typeof HARFORD_BBOX, rows = 4, cols = 4): Tile[] {
  const tiles: Tile[] = [];
  const dLat = (bbox.north - bbox.south) / rows;
  const dLng = (bbox.east - bbox.west) / cols;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const south = bbox.south + r * dLat;
      const west = bbox.west + c * dLng;
      tiles.push({
        key: `r${r}c${c}`,
        south: round6(south),
        west: round6(west),
        north: round6(r === rows - 1 ? bbox.north : south + dLat),
        east: round6(c === cols - 1 ? bbox.east : west + dLng),
      });
    }
  }
  return tiles;
}

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

/**
 * What a person on foot, a scooter or a van can use. Motorways and their
 * ramps are out; so are steps, and things that are not ways at all.
 */
export const ROAD_KINDS = [
  "residential",
  "unclassified",
  "tertiary",
  "tertiary_link",
  "secondary",
  "secondary_link",
  "primary",
  "primary_link",
  "living_street",
  "service",
  "track",
  "road",
  "pedestrian",
  "footway",
  "path",
  "cycleway",
];

export function overpassQuery(tile: Tile): string {
  const kinds = ROAD_KINDS.join("|");
  return `[out:json][timeout:50];way["highway"~"^(${kinds})$"](${tile.south},${tile.west},${tile.north},${tile.east});out geom;`;
}

export const OVERPASS_ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

/** The same metre frame the USPS lines use: x east of Greenwich, y north of the equator, scaled at Harford's latitude. */
const KX = Math.cos((39.5 * Math.PI) / 180) * 111320;
const KY = 110574;

/** [osm id, highway, name, x1, y1, x2, y2] in metres. */
export type RoadSegmentRow = [number, string, string | null, number, number, number, number];

interface OverpassWay {
  type?: string;
  id?: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

/** Every way's consecutive point pairs, as straight segments in metres. */
export function parseOverpass(body: unknown): RoadSegmentRow[] {
  const elements = body && typeof body === "object" && Array.isArray((body as { elements?: unknown }).elements) ? ((body as { elements: OverpassWay[] }).elements) : [];
  const rows: RoadSegmentRow[] = [];
  for (const way of elements) {
    if (way.type !== "way" || !Array.isArray(way.geometry) || typeof way.id !== "number") continue;
    const highway = way.tags?.highway ?? "";
    if (!ROAD_KINDS.includes(highway)) continue;
    const name = way.tags?.name ?? null;
    for (let i = 0; i < way.geometry.length - 1; i++) {
      const a = way.geometry[i];
      const b = way.geometry[i + 1];
      if (!isFinite(a.lat) || !isFinite(a.lon) || !isFinite(b.lat) || !isFinite(b.lon)) continue;
      const x1 = a.lon * KX;
      const y1 = a.lat * KY;
      const x2 = b.lon * KX;
      const y2 = b.lat * KY;
      if (x1 === x2 && y1 === y2) continue;
      rows.push([way.id, highway, name, round2(x1), round2(y1), round2(x2), round2(y2)]);
    }
  }
  return rows;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export interface OsmScope {
  tiles: Tile[];
}

export interface OsmCheckpoint {
  offset: number;
  attempts: number;
}

export function describeRoadsImport(job: Pick<JobRow, "status" | "fetched" | "last_error" | "scope" | "checkpoint">): string {
  const tiles = ((job.scope ?? {}) as Partial<OsmScope>).tiles?.length ?? 0;
  const done = ((job.checkpoint ?? {}) as Partial<OsmCheckpoint>).offset ?? 0;
  const progress = tiles > 0 ? `${done} of ${tiles} tiles, ${job.fetched.toLocaleString()} road segments` : `${job.fetched.toLocaleString()} road segments`;
  if (job.status === "running") return `Reading the county's roads from OpenStreetMap: ${progress}.`;
  if (job.status === "failed") return `Stopped at ${progress}: ${job.last_error ?? "unknown error"}.`;
  if (job.status === "paused") return `Paused at ${progress}.`;
  return `Read ${progress}. The walks are being redrawn on the roads.`;
}
