/**
 * Evaluator territories: the zip codes, or the area drawn on a map, each
 * evaluator covers.
 *
 * Optional, and only a preference. An evaluator with no territory covers
 * everywhere, as before. When an address falls inside somebody's territory
 * and they are free, they get it; when nobody whose territory it is can make
 * the time, the booking still goes to whoever is free, because a client
 * offered a time must keep it. A territory decides between the free, it
 * never takes a time away.
 *
 * Pure, so the geometry is tested without a database.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Territory {
  evaluatorId: string;
  /** Five-digit zip codes. */
  zips: string[];
  /** Polygons drawn on the map, each a ring of points (not closed). */
  areas: LatLng[][];
  active: boolean;
}

export interface Place {
  lat: number | null;
  lng: number | null;
  zip: string | null;
}

/** Five-digit zips out of whatever was typed: "21014, 21015 21050-1234" reads as three. */
export function readZips(text: string | string[] | null | undefined): string[] {
  const all = Array.isArray(text) ? text.join(" ") : text ?? "";
  return [...new Set((all.match(/\b\d{5}(?:-\d{4})?\b/g) ?? []).map((z) => z.slice(0, 5)))];
}

/** Ray casting. Points exactly on an edge may go either way, which is fine for a sales territory. */
export function pointInPolygon(point: LatLng, ring: LatLng[]): boolean {
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    const crosses = a.lat > point.lat !== b.lat > point.lat && point.lng < ((b.lng - a.lng) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lng;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Whether this territory has anything in it. An empty one is the same as none. */
export function isDefined(territory: Territory): boolean {
  return territory.active && (territory.zips.length > 0 || territory.areas.some((ring) => ring.length >= 3));
}

/** Whether the territory covers the place, by zip or by drawn area. */
export function covers(territory: Territory, place: Place): boolean {
  if (!isDefined(territory)) return false;
  if (place.zip && territory.zips.includes(place.zip.slice(0, 5))) return true;
  if (place.lat == null || place.lng == null) return false;
  return territory.areas.some((ring) => pointInPolygon({ lat: place.lat!, lng: place.lng! }, ring));
}

/**
 * Of the free evaluators, the ones whose territory covers the place. Empty
 * when nobody has a territory there; the caller then chooses among everyone
 * free, as it always did.
 */
export function inTerritory(candidateIds: string[], territories: Territory[], place: Place): string[] {
  const covering = new Set(territories.filter((t) => covers(t, place)).map((t) => t.evaluatorId));
  return candidateIds.filter((id) => covering.has(id));
}

/** Reads a stored drawn area: GeoJSON-style [[lng, lat], ...] rings, or {lat, lng} points. */
export function readAreas(raw: unknown): LatLng[][] {
  if (!Array.isArray(raw)) return [];
  const rings: LatLng[][] = [];
  for (const ring of raw) {
    if (!Array.isArray(ring)) continue;
    const points: LatLng[] = [];
    for (const p of ring) {
      if (Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])) points.push({ lng: Number(p[0]), lat: Number(p[1]) });
      else if (p && typeof p === "object" && Number.isFinite((p as LatLng).lat) && Number.isFinite((p as LatLng).lng)) points.push({ lat: (p as LatLng).lat, lng: (p as LatLng).lng });
    }
    // A closed ring repeats its first point; the test does not need it.
    if (points.length > 1 && points[0].lat === points[points.length - 1].lat && points[0].lng === points[points.length - 1].lng) points.pop();
    if (points.length >= 3) rings.push(points);
  }
  return rings;
}

/** For storage: [[lng, lat], ...] per ring, the order GeoJSON and Mapbox use. */
export function writeAreas(areas: LatLng[][]): number[][][] {
  return areas.filter((ring) => ring.length >= 3).map((ring) => ring.map((p) => [round6(p.lng), round6(p.lat)]));
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
