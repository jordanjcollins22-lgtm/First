/**
 * The order a snow route is driven in.
 *
 * The office's own order wins wherever it has set one, because they know
 * that the hospital lot goes first and the church can wait until after the
 * school. Everything they have not ordered is chained by distance from the
 * last stop, starting from the shop: straight-line nearest-next, which is
 * not optimal and does not pretend to be, but is a long way better than the
 * order people happened to sign up in. Stops with no coordinates go last,
 * by name, because there is no honest place to put them.
 *
 * Pure.
 */

import { milesApart } from "@/lib/schedule-engine";

export interface RouteCandidate {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  /** The office's position for it, when set. Lower goes first. */
  routeOrder: number | null;
}

export function orderRoute<T extends RouteCandidate>(stops: readonly T[], origin: { lat: number | null; lng: number | null } | null): T[] {
  const fixed = stops
    .filter((s) => s.routeOrder != null)
    .sort((a, b) => (a.routeOrder as number) - (b.routeOrder as number) || a.name.localeCompare(b.name));
  const placeable = stops.filter((s) => s.routeOrder == null && s.lat != null && s.lng != null);
  const unplaced = stops.filter((s) => s.routeOrder == null && (s.lat == null || s.lng == null)).sort((a, b) => a.name.localeCompare(b.name));

  const out: T[] = [...fixed];
  let here: { lat: number | null; lng: number | null } | null = fixed.length > 0 ? fixed[fixed.length - 1] : origin;
  const left = [...placeable];
  while (left.length > 0) {
    let best = 0;
    if (here && here.lat != null && here.lng != null) {
      let bestMiles = Number.POSITIVE_INFINITY;
      left.forEach((s, i) => {
        const miles = milesApart(here!, s) ?? Number.POSITIVE_INFINITY;
        if (miles < bestMiles) {
          bestMiles = miles;
          best = i;
        }
      });
    }
    const [next] = left.splice(best, 1);
    out.push(next);
    here = next;
  }
  return [...out, ...unplaced];
}
