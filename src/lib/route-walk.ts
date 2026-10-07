/**
 * Walking a round, one door at a time.
 *
 * The whole screen is one question — which house next — and these are the two
 * things it needs to answer it. Kept out of the component so both can be
 * tested without a browser.
 */

export interface Stop {
  id: string;
  address: string;
  lat: number;
  lng: number;
}

/**
 * A maps link for the next stop, or for a run of them.
 *
 * Google takes up to a handful of waypoints in one link, which is what turns
 * "navigate to this door" into "drive this street". More than that and the URL
 * is refused, so it is capped rather than sent hopefully.
 */
export const MAX_WAYPOINTS = 8;

export function directionsUrl(stops: readonly Stop[], from?: { lat: number; lng: number } | null): string | null {
  if (stops.length === 0) return null;
  const run = stops.slice(0, MAX_WAYPOINTS);
  const destination = run[run.length - 1];
  const waypoints = run.slice(0, -1);

  const params = new URLSearchParams({
    api: "1",
    destination: `${destination.lat},${destination.lng}`,
    travelmode: "driving",
  });
  if (from) params.set("origin", `${from.lat},${from.lng}`);
  if (waypoints.length > 0) {
    params.set("waypoints", waypoints.map((s) => `${s.lat},${s.lng}`).join("|"));
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export interface WalkProgress {
  done: number;
  total: number;
  /** The next door, or null when the round is finished. */
  next: Stop | null;
  /** The ones after it, for the run link. */
  upcoming: Stop[];
  percent: number;
  finished: boolean;
}

/**
 * Where somebody is up to.
 *
 * `done` is a count rather than a set on purpose: a round is walked in order,
 * and the person holding the phone is at a position in a list, not curating a
 * selection. Going back one is subtracting one.
 */
export function progressOf(stops: readonly Stop[], done: number): WalkProgress {
  const total = stops.length;
  const at = Math.max(0, Math.min(done, total));
  return {
    done: at,
    total,
    next: stops[at] ?? null,
    upcoming: stops.slice(at + 1, at + MAX_WAYPOINTS),
    percent: total === 0 ? 0 : Math.round((at / total) * 100),
    finished: total > 0 && at >= total,
  };
}
