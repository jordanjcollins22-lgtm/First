/**
 * The order a crew works its day: start where the office said to start, then
 * always go to the closest job left from the one just finished.
 *
 * The starting job is the first stop as given (the office's stop_order). Jobs
 * already finished keep the order they were finished in, and the next job is
 * picked from wherever the crew finished last, so when a job is done the rest
 * of the day re-routes from that spot. A job with no map pin can't be measured
 * and goes last, in the order it came.
 *
 * When the office has set a crew's order by hand (the Schedule map), the
 * stops come back exactly as given.
 */

export interface Routable {
  jobId: string;
  lat: number | null;
  lng: number | null;
  /** Set by the office on the Schedule map: the order as given is the order. */
  locked?: boolean;
}

type Pinned<T> = T & { lat: number; lng: number };

const pinned = <T extends Routable>(s: T): s is Pinned<T> =>
  typeof s.lat === "number" && typeof s.lng === "number" && Number.isFinite(s.lat) && Number.isFinite(s.lng);

/** Straight-line miles between two points. */
export function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function routeByNearest<T extends Routable>(stops: readonly T[], finishedJobIds: readonly string[] = []): T[] {
  if (stops.length <= 1) return [...stops];
  // The office set this crew's order by hand: keep it exactly as given.
  if (stops.some((s) => s.locked)) return [...stops];
  const byJob = new Map(stops.map((s) => [s.jobId, s]));
  const done: T[] = [];
  for (const id of finishedJobIds) {
    const s = byJob.get(id);
    if (s && !done.includes(s)) done.push(s);
  }
  let left = stops.filter((s) => !done.includes(s));
  const route = [...done];

  // Nothing finished yet: the office's first stop is where the day starts.
  if (route.length === 0) {
    route.push(left[0]);
    left = left.slice(1);
  }

  while (left.length) {
    const from = [...route].reverse().find(pinned);
    const candidates = left.filter(pinned);
    if (!from || candidates.length === 0) break;
    let best = candidates[0];
    let bestMiles = milesBetween(from, best);
    for (const c of candidates.slice(1)) {
      const m = milesBetween(from, c);
      if (m < bestMiles) {
        best = c;
        bestMiles = m;
      }
    }
    route.push(best);
    left = left.filter((s) => s !== best);
  }
  return [...route, ...left];
}

/**
 * Lines that warn the crew about something on site, picked out of the visit
 * and job notes, so a gas line written into "what's left" also shows as a
 * hazard at the top of the crew page instead of mid-sentence.
 */
const HAZARD =
  /\b(gas|electric\w*|power ?lines?|wires?|buried|utility|utilities|septic|well head|sprinklers?|irrigation|propane|dogs?|bees?|wasps?|hornets?|yellow ?jackets?|snakes?|poison ivy|ticks?|steep slope|drop[- ]?off|ice|icy|glass|nails?|careful|caution|hazard\w*|danger\w*|watch out|do not|don't)\b/i;

export function hazardLines(...texts: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const text of texts) {
    for (const piece of (text ?? "").split(/(?<=[.!?])\s+|\n+/)) {
      const line = piece.trim();
      if (line && HAZARD.test(line) && !out.includes(line)) out.push(line);
    }
  }
  return out;
}

/** Today's visit if there is one, else the next one, else the last one booked. */
export function pickVisit<T extends { starts_on: string; ends_on: string }>(visits: readonly T[], day: string): T | null {
  return (
    visits.find((v) => v.starts_on <= day && v.ends_on >= day) ??
    visits.find((v) => v.starts_on > day) ??
    visits[visits.length - 1] ??
    null
  );
}
