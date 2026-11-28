/**
 * A picture of today's routes: each crew's stops as numbered pins joined by a
 * line in the crew's color, as one Mapbox static image. Straight lines from
 * stop to stop: it shows the order, not the roads.
 */

export interface MapCrew {
  color: string;
  stops: { lat: number | null; lng: number | null }[];
}

/** Google's encoded polyline (precision 5), which Mapbox path overlays take. */
export function encodePolyline(points: [number, number][]): string {
  let out = "";
  let prevLat = 0;
  let prevLng = 0;
  const enc = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    let s = "";
    while (n >= 0x20) {
      s += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    return s + String.fromCharCode(n + 63);
  };
  for (const [lat, lng] of points) {
    const la = Math.round(lat * 1e5);
    const ln = Math.round(lng * 1e5);
    out += enc(la - prevLat) + enc(ln - prevLng);
    prevLat = la;
    prevLng = ln;
  }
  return out;
}

const hex = (c: string) => c.replace(/^#/, "").toLowerCase();

/** The image URL, or null when there's no token or no pinned stop. */
export function routeMapUrl(crews: MapCrew[], token: string, size = { w: 640, h: 420 }): string | null {
  if (!token) return null;
  const overlays: string[] = [];
  let pins = 0;
  for (const crew of crews) {
    const pts = crew.stops
      .map((s, i) => ({ i, lat: s.lat, lng: s.lng }))
      .filter((s): s is { i: number; lat: number; lng: number } => typeof s.lat === "number" && typeof s.lng === "number");
    if (pts.length >= 2) {
      overlays.push(`path-5+${hex(crew.color)}-0.85(${encodeURIComponent(encodePolyline(pts.map((p) => [p.lat, p.lng])))})`);
    }
    for (const p of pts) {
      overlays.push(`pin-l-${Math.min(p.i + 1, 99)}+${hex(crew.color)}(${p.lng.toFixed(5)},${p.lat.toFixed(5)})`);
      pins++;
    }
  }
  if (pins === 0) return null;
  return (
    `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${overlays.join(",")}/auto/${size.w}x${size.h}@2x` +
    `?padding=60&access_token=${encodeURIComponent(token)}`
  );
}
